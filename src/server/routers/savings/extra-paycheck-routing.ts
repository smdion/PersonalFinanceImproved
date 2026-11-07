import { eq, asc, isNull, and } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  savingsProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { resolveActiveSalaryProfileId } from "@/server/data/salaries";
import { loadEffectiveSalaryProfile } from "@/server/services/profiles/salary-profile";
import type { SalaryEntryMap } from "@/lib/pure/household/compensation";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { materializeExtraPaycheckSavings } from "@/server/services/budget/extra-paycheck-materializer";
import { materializeBudgetIncomeAdjustments } from "@/server/services/budget/budget-income-materializer";
import type { DbOrTx } from "@/lib/db";
import { computeJobNetPayPerCheck } from "@/server/services/paycheck/job-net-pay";

/**
 * Write a job's extraPaycheckRouting field into its entry in the globally-
 * ACTIVE Salary Profile — never a locally-viewed/What-If-pinned one. This
 * mirrors baseNetPayPerCheck's existing rule (see ExtraPaycheckRoutingData's
 * docblock, schema-pg.ts): switching which profile a user is casually
 * comparing must never silently rewrite already-materialized real
 * savings_planned_transactions, so routing always targets whichever profile
 * is the deliberate, globally-active one at write time.
 *
 * Throws PRECONDITION_FAILED when there's no active profile, or the job has
 * no entry in it — same "explicit user-initiated save should reject rather
 * than fabricate a home for the data" rule as computeJobNetPayPerCheck.
 */
async function writeJobExtraPaycheckRouting(
  db: DbOrTx,
  jobId: number,
  routing: ExtraPaycheckRoutingData | null,
): Promise<void> {
  const activeId = await resolveActiveSalaryProfileId(db);
  if (activeId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No Salary Profile is active — activate one before configuring extra-paycheck routing.",
    });
  }
  const [row] = await db
    .select()
    .from(schema.salaryProfiles)
    .where(eq(schema.salaryProfiles.id, activeId));
  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The active Salary Profile no longer exists.",
    });
  }
  const salaries = row.salaries as SalaryEntryMap;
  const key = String(jobId);
  const entry = salaries[key];
  if (!entry) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Job ${jobId} has no entry in the active Salary Profile — add one before configuring extra-paycheck routing.`,
    });
  }
  await db
    .update(schema.salaryProfiles)
    .set({
      salaries: {
        ...salaries,
        [key]: { ...entry, extraPaycheckRouting: routing },
      },
    })
    .where(eq(schema.salaryProfiles.id, activeId));
}

export const extraPaycheckRoutingProcedures = {
  // ══ EXTRA PAYCHECK ROUTING ══
  extraPaycheckRouting: createTRPCRouter({
    /** Load routing rules for all jobs. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const jobs = await ctx.db
        .select({
          id: schema.jobs.id,
          personId: schema.jobs.personId,
          employerName: schema.jobs.employerName,
        })
        .from(schema.jobs)
        .where(
          and(
            isNull(schema.jobs.endDate),
            eq(schema.jobs.isSpeculative, false),
          ),
        )
        .orderBy(asc(schema.jobs.personId), asc(schema.jobs.id));
      const people = await ctx.db
        .select({ id: schema.people.id, name: schema.people.name })
        .from(schema.people);
      const personMap = new Map(people.map((p) => [p.id, p.name]));
      // Prefer the routing snapshot's own payPeriod/anchorPayDate (frozen at
      // save time — see ExtraPaycheckRoutingData's docblock) so a later job
      // correction doesn't retroactively change what this editor shows for
      // already-saved rules. Only a job with no routing saved yet (or a
      // pre-snapshot routing row) has no frozen schedule to read — resolve
      // live from the job's Salary Profile entry in that case, the one
      // place a live resolution still belongs (nothing to freeze until the
      // first save). `null` here is a genuine "incomplete" state — no
      // snapshot AND no active Salary Profile entry for this job.
      const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
        ctx.db,
        null,
      );
      return jobs.map((j) => {
        const entry = salaryProfileActiveMap.get(j.id);
        const extraPaycheckRouting = entry?.extraPaycheckRouting ?? null;
        return {
          ...j,
          extraPaycheckRouting,
          payPeriod:
            extraPaycheckRouting?.payPeriod ?? entry?.payPeriod ?? null,
          anchorPayDate:
            extraPaycheckRouting?.anchorPayDate !== undefined
              ? extraPaycheckRouting.anchorPayDate
              : (entry?.anchorPayDate ?? null),
          personName: personMap.get(j.personId) ?? "Unknown",
        };
      });
    }),

    /** Save routing rules for a single job and re-materialize. Preserves existing overrides and growth settings. */
    save: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          rules: z.array(
            z.object({
              from: z.string().regex(/^\d{4}-\d{2}$/),
              to: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .nullable(),
              splits: z.array(
                z.object({
                  goalId: z.number().int(),
                  pct: z.number().min(0).max(100),
                }),
              ),
            }),
          ),
          /** Per-year growth rates; keyed by year string e.g. "2027". */
          yearlyGrowth: z
            .record(
              z.string(),
              z.object({ type: z.enum(["pct", "dollar"]), value: z.number() }),
            )
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Validate: splits for each rule must sum to 100
        for (const rule of input.rules) {
          const total = rule.splits.reduce((s, sp) => s + sp.pct, 0);
          if (Math.abs(total - 100) > 0.01) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Rule starting ${rule.from}: splits must sum to 100% (got ${total.toFixed(1)}%)`,
            });
          }
          if (rule.to !== null && rule.to < rule.from)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Rule starting ${rule.from} ends before it starts`,
            });
          // Validate no overlapping date ranges (two rules starting the same
          // month overlap too — which would win is arbitrary)
          for (const other of input.rules) {
            if (other === rule) continue;
            const aEnd = rule.to ?? "9999-12";
            const bEnd = other.to ?? "9999-12";
            if (rule.from <= bEnd && other.from <= aEnd) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Rules overlap: ${rule.from}–${rule.to ?? "∞"} and ${other.from}–${other.to ?? "∞"}`,
              });
            }
          }
        }

        // Preserve existing overrides and growth settings when saving rules
        const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
          ctx.db,
          null,
        );
        const existing = salaryProfileActiveMap.get(
          input.jobId,
        )?.extraPaycheckRouting;
        const existingOverrides = existing?.overrides ?? [];

        // Always recompute net pay from the paycheck calculator — never trust a client-supplied value.
        const {
          netPayPerCheck: baseNetPayPerCheck,
          payPeriod,
          anchorPayDate,
        } = await computeJobNetPayPerCheck(ctx.db, input.jobId);
        const nowYear = ctx.scope.asOf.getFullYear();
        await writeJobExtraPaycheckRouting(
          ctx.db,
          input.jobId,
          input.rules.length > 0
            ? {
                rules: input.rules,
                overrides: existingOverrides,
                baseNetPayPerCheck,
                baseYear: nowYear,
                payPeriod,
                anchorPayDate,
                yearlyGrowth:
                  input.yearlyGrowth !== undefined
                    ? input.yearlyGrowth
                    : existing?.yearlyGrowth,
              }
            : null,
        );

        await materializeExtraPaycheckSavings(ctx.db);
        await materializeBudgetIncomeAdjustments(ctx.db);
        return { ok: true };
      }),

    /** Persist growth rates for a job, then re-materialize. Net pay is always recomputed server-side. */
    saveGrowth: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          yearlyGrowth: z.record(
            z.string(),
            z.object({ type: z.enum(["pct", "dollar"]), value: z.number() }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
          ctx.db,
          null,
        );
        const existing = salaryProfileActiveMap.get(
          input.jobId,
        )?.extraPaycheckRouting;
        if (!existing) return { ok: true };

        const {
          netPayPerCheck: baseNetPayPerCheck,
          payPeriod,
          anchorPayDate,
        } = await computeJobNetPayPerCheck(ctx.db, input.jobId);
        const nowYear = ctx.scope.asOf.getFullYear();
        await writeJobExtraPaycheckRouting(ctx.db, input.jobId, {
          ...existing,
          baseNetPayPerCheck,
          baseYear: nowYear,
          payPeriod,
          anchorPayDate,
          yearlyGrowth: input.yearlyGrowth,
        });

        await materializeExtraPaycheckSavings(ctx.db);
        await materializeBudgetIncomeAdjustments(ctx.db);
        return { ok: true };
      }),

    /**
     * Pause or resume routing without touching the configured rules —
     * "Budget" mode (enabled: false) means the extra paycheck isn't
     * diverted to any goal and stays as regular income, same as a job with
     * no routing at all; switching back to "Savings" (enabled: true)
     * restores exactly what was configured before. A no-op if the job has
     * no routing configured yet (nothing to pause).
     */
    setEnabled: savingsProcedure
      .input(z.object({ jobId: z.number().int(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
          ctx.db,
          null,
        );
        const existing = salaryProfileActiveMap.get(
          input.jobId,
        )?.extraPaycheckRouting;
        if (!existing) return { ok: true };

        await writeJobExtraPaycheckRouting(ctx.db, input.jobId, {
          ...existing,
          enabled: input.enabled,
        });

        await materializeExtraPaycheckSavings(ctx.db);
        await materializeBudgetIncomeAdjustments(ctx.db);
        return { ok: true };
      }),

    /** Upsert or delete a one-time override for a specific extra-paycheck month. */
    saveOverride: savingsProcedure
      .input(
        z.object({
          jobId: z.number().int(),
          month: z.string().regex(/^\d{4}-\d{2}$/),
          splits: z
            .array(
              z.object({
                goalId: z.number().int(),
                pct: z.number().min(0).max(100),
              }),
            )
            .nullable(), // null = delete the override
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.splits !== null) {
          const total = input.splits.reduce((s, sp) => s + sp.pct, 0);
          if (Math.abs(total - 100) > 0.01) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `A month's split must add up to 100% (got ${total.toFixed(1)}%)`,
            });
          }
        }

        const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
          ctx.db,
          null,
        );
        const routing = salaryProfileActiveMap.get(
          input.jobId,
        )?.extraPaycheckRouting;
        if (!routing) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No routing rules for this job",
          });
        }

        let overrides = routing.overrides ?? [];

        if (input.splits === null) {
          overrides = overrides.filter((o) => o.month !== input.month);
        } else {
          const exists = overrides.some((o) => o.month === input.month);
          if (exists) {
            overrides = overrides.map((o) =>
              o.month === input.month ? { ...o, splits: input.splits! } : o,
            );
          } else {
            overrides = [
              ...overrides,
              { month: input.month, splits: input.splits },
            ];
          }
        }

        await writeJobExtraPaycheckRouting(ctx.db, input.jobId, {
          ...routing,
          overrides,
        });

        await materializeExtraPaycheckSavings(ctx.db);
        await materializeBudgetIncomeAdjustments(ctx.db);
        return { ok: true };
      }),
  }),
};
