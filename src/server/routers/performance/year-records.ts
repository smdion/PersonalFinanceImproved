import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { performanceProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import {
  captureYearRollups,
  syncYearRollups,
} from "@/server/services/performance/performance-rollups";
import { loadPerformanceChecks } from "@/server/services/performance/performance-checks";
import {
  editAccountRow,
  type AccountEdit,
  type EditPreview,
} from "@/server/services/performance/performance-edit";
import {
  acceptedCheckSchema,
  parseAcceptedChecks,
  parseEstimatedFields,
  perfCheckKindSchema,
  perfFieldSchema,
  PERF_NOTE_MAX,
} from "@/lib/pure/investments/performance-annotations";
import { zDecimal } from "@/lib/utils/zod-fields";
import { recordFill, zFillRecord } from "@/server/services/sync/fill-ledger";
import type { DbOrTx } from "@/lib/db";
import { stampPerformanceUpdated } from "@/server/services/performance/last-updated";

/** Thrown inside a preview's transaction to roll it back; caught by the
 *  procedure itself, never sent to the client. */
class DryRunRollback extends Error {}

/** Optional decimal — for partial-update mutations. */
const zDecimalOpt = zDecimal.optional();

const annualUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: zDecimalOpt,
  totalContributions: zDecimalOpt,
  yearlyGainLoss: zDecimalOpt,
  endingBalance: zDecimalOpt,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimalOpt,
  fees: zDecimalOpt,
  distributions: zDecimalOpt,
  rollovers: zDecimalOpt,
});

const accountUpdateInput = z.object({
  id: z.number().int(),
  beginningBalance: zDecimalOpt,
  totalContributions: zDecimalOpt,
  yearlyGainLoss: zDecimalOpt,
  endingBalance: zDecimalOpt,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimalOpt,
  fees: zDecimalOpt,
  distributions: zDecimalOpt,
  rollovers: zDecimalOpt,
});

const accountCreateInput = z.object({
  year: z.number().int(),
  performanceAccountId: z.number().int(),
  beginningBalance: zDecimal,
  totalContributions: zDecimal,
  yearlyGainLoss: zDecimal,
  endingBalance: zDecimal,
  annualReturnPct: z.string().nullable().optional(),
  employerContributions: zDecimal.default("0"),
  fees: zDecimal.default("0"),
  distributions: zDecimal.default("0"),
  rollovers: zDecimal.default("0"),
  isActive: z.boolean().default(true),
});

export const yearRecordProcedures = {
  /**
   * Edit a year's category totals row; lifetime totals are refused on a finalized year (they follow its
   * account rows). Stamps the performance date.
   */
  updateAnnual: performanceProcedure
    .input(annualUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const updates: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined /* superjson keeps a key sent as undefined */) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length === 0) return { ok: true };

      // Block lifetime_* edits on immutable rows: finalized lifetime totals move only
      // with the year's account_performance rows (syncYearRollups carries them
      // forward). DESIGN.md § Data Model Principles point 4 cascade rule.
      const LIFETIME_FIELDS = new Set([
        "lifetimeGains",
        "lifetimeContributions",
        "lifetimeMatch",
      ]);
      const touchesLifetime = Object.keys(updates).some((k) =>
        LIFETIME_FIELDS.has(k),
      );
      if (touchesLifetime) {
        const [row] = await ctx.db
          .select({ isImmutable: schema.annualPerformance.isImmutable })
          .from(schema.annualPerformance)
          .where(eq(schema.annualPerformance.id, id))
          .limit(1);
        if (row?.isImmutable) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Cannot edit lifetime fields on a finalized annual_performance row directly. " +
              "Edit the underlying account_performance rows instead — the cascade will recompute lifetime totals.",
          });
        }
      }

      await ctx.db
        .update(schema.annualPerformance)
        .set(updates)
        .where(eq(schema.annualPerformance.id, id));
      await stampPerformanceUpdated(ctx.db);
      return { ok: true };
    }),

  /**
   * Edit one account row via editAccountRow (rows stay balanced, rollups follow).
   * `chainNextYear` moves next year's beginning; `dryRun` returns changes, writes nothing.
   */
  updateAccount: performanceProcedure
    .input(
      accountUpdateInput.extend({
        chainNextYear: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, chainNextYear, dryRun, annualReturnPct, ...fields } = input;
      const edit = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined), // see above
      ) as AccountEdit;
      if (Object.keys(edit).length === 0 && annualReturnPct === undefined)
        return { ok: true, preview: null };
      const run = async (tx: DbOrTx) => {
        if (annualReturnPct !== undefined)
          await tx
            .update(schema.accountPerformance)
            .set({ annualReturnPct })
            .where(eq(schema.accountPerformance.id, id));
        return Object.keys(edit).length > 0
          ? editAccountRow(tx, id, edit, { chainNextYear })
          : null;
      };
      if (dryRun) {
        let preview: EditPreview | null = null;
        try {
          await ctx.db.transaction(async (tx) => {
            preview = await run(tx);
            throw new DryRunRollback();
          });
        } catch (e) {
          if (!(e instanceof DryRunRollback)) throw e;
        }
        return { ok: true, preview };
      }
      const preview = await ctx.db.transaction(async (tx) => {
        const p = await run(tx);
        await stampPerformanceUpdated(tx);
        return p;
      });
      return { ok: true, preview };
    }),

  /**
   * An account-year's note, which figures are estimates, and gaps accepted on purpose
   * (each with a reason; the check returns when the gap differs from the accepted one).
   * Not a figure change: the performance timestamp doesn't move.
   */
  annotateAccount: performanceProcedure
    .input(
      z.object({
        id: z.number().int(),
        note: z.string().trim().max(PERF_NOTE_MAX).nullable().optional(),
        estimatedFields: z.array(perfFieldSchema).optional(),
        accept: z
          .object({
            kind: perfCheckKindSchema,
            note: acceptedCheckSchema.shape.note,
          })
          .optional(),
        unaccept: perfCheckKindSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.id, input.id));
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That Performance row no longer exists.",
          });
        const accepted = parseAcceptedChecks(row.acceptedChecks);
        if (input.unaccept) delete accepted[input.unaccept];
        if (input.accept) {
          const check = (await loadPerformanceChecks(tx))
            .get(row.id)
            ?.find((c) => c.kind === input.accept!.kind);
          if (!check)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "There's no such gap on this row any more — nothing to accept.",
            });
          accepted[input.accept.kind] = {
            amount:
              check.kind === "transfers"
                ? toNumber(row.rollovers)
                : check.amount,
            note: input.accept.note,
            on: ctx.scope.today,
          };
        }
        await tx
          .update(schema.accountPerformance)
          .set({
            ...(input.note !== undefined && { note: input.note || null }),
            ...(input.estimatedFields && {
              estimatedFields: parseEstimatedFields(input.estimatedFields),
            }),
            acceptedChecks: accepted,
          })
          .where(eq(schema.accountPerformance.id, row.id));
        return { ok: true };
      });
    }),

  /**
   * Add an account's row for a year, its label, owner and category copied from the performance
   * account; stamps the performance date and returns the row.
   */
  createAccount: performanceProcedure
    .input(accountCreateInput)
    .mutation(async ({ ctx, input }) => {
      // Look up master account to get denormalized fields
      const [master] = await ctx.db
        .select()
        .from(schema.performanceAccounts)
        .where(eq(schema.performanceAccounts.id, input.performanceAccountId));
      if (!master)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Performance account ${input.performanceAccountId} not found`,
        });

      const [row] = await ctx.db
        .insert(schema.accountPerformance)
        .values({
          year: input.year,
          institution: master.institution,
          accountLabel: master.accountLabel,
          ownerPersonId: master.ownerPersonId,
          parentCategory: master.parentCategory,
          isActive: input.isActive,
          performanceAccountId: input.performanceAccountId,
          beginningBalance: input.beginningBalance,
          totalContributions: input.totalContributions,
          yearlyGainLoss: input.yearlyGainLoss,
          endingBalance: input.endingBalance,
          annualReturnPct: input.annualReturnPct ?? null,
          employerContributions: input.employerContributions,
          fees: input.fees,
          distributions: input.distributions,
          rollovers: input.rollovers,
        })
        .returning();
      await stampPerformanceUpdated(ctx.db);
      return row;
    }),

  /**
   * Batch-update account_performance rows for the current year.
   * Used by the Update Performance form to save all flow fields in one pass.
   * Annual rollups are recomputed automatically by computeSummary on next query.
   */
  batchUpdateAccounts: performanceProcedure
    .input(
      z.object({
        accounts: z.array(
          z.object({
            id: z.number().int(),
            /** Omitted: the stored beginning stays. */
            beginningBalance: zDecimal.optional(),
            /** Figures still estimated; omitted: the stored marks stay. */
            estimatedFields: z.array(perfFieldSchema).optional(),
            note: z.string().trim().max(PERF_NOTE_MAX).nullable().optional(),
            totalContributions: zDecimal,
            employerContributions: zDecimal,
            distributions: zDecimal,
            rollovers: zDecimal,
            fees: zDecimal,
            endingBalance: zDecimal,
            yearlyGainLoss: zDecimal,
          }),
        ),
        /** Set when the figures were filled from SimpleFIN: what they
         *  counted, so the next fill adds only what's new. */
        simplefinFill: zFillRecord.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.accounts.length === 0) return { ok: true };
      await ctx.db.transaction(async (tx) => {
        const years = await tx
          .selectDistinct({ year: schema.accountPerformance.year })
          .from(schema.accountPerformance)
          .where(
            inArray(
              schema.accountPerformance.id,
              input.accounts.map((a) => a.id),
            ),
          )
          .orderBy(schema.accountPerformance.year);
        const before = [];
        // One at a time on the transaction's connection, years ascending
        // (each capture takes its year's lock).
        for (const { year } of years)
          before.push(await captureYearRollups(tx, year));
        for (const account of input.accounts) {
          await tx
            .update(schema.accountPerformance)
            .set({
              ...(account.beginningBalance !== undefined && {
                beginningBalance: account.beginningBalance,
              }),
              ...(account.estimatedFields && {
                estimatedFields: parseEstimatedFields(account.estimatedFields),
              }),
              ...(account.note !== undefined && { note: account.note || null }),
              totalContributions: account.totalContributions,
              employerContributions: account.employerContributions,
              distributions: account.distributions,
              rollovers: account.rollovers,
              fees: account.fees,
              endingBalance: account.endingBalance,
              yearlyGainLoss: account.yearlyGainLoss,
            })
            .where(eq(schema.accountPerformance.id, account.id));
        }
        for (const b of before) await syncYearRollups(tx, b);
        await stampPerformanceUpdated(tx);
        if (input.simplefinFill)
          await recordFill(
            tx,
            "performance",
            input.simplefinFill,
            ctx.scope.asOf,
          );
      });
      return { ok: true };
    }),
};
