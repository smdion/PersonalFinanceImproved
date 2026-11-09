/**
 * Salary Profiles: named per-job salary sets, each a complete independent world keyed
 * by jobId. Every entry is complete (salary + bonus terms) or absent; never partial.
 */
import { DEFAULT_BONUS_DESTINATION } from "@/lib/config/enum-values";
import {
  BLANK_SALARY_ENTRY,
  type SalaryEntry,
} from "@/lib/db/salary-entry-defaults";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";
import { materializeExtraPaycheckSavings } from "@/server/services/budget/extra-paycheck-materializer";
import { createTRPCRouter } from "../trpc";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { salaryEntriesSchema, salaryEntrySchema } from "@/lib/db/json-schemas";
import { resolveCompensation } from "@/lib/pure/household/compensation";
import type { SalaryEntryMap } from "@/lib/pure/household/compensation";
import { resolveActiveSalaryProfileId } from "@/server/data/salaries";
import { fetchSalaryProfile } from "@/server/data/salaries";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import { computeJobNetPayPerCheck } from "@/server/services/paycheck/job-net-pay";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  setActiveProfile,
} from "@/server/services/profiles/profile-lifecycle";

/** How much this profile specifies, for the list view's at-a-glance summary. */
function summarizeEntries(salaries: SalaryEntryMap) {
  const entries = Object.values(salaries);
  return {
    pinnedCount: entries.length,
    pinnedSalaryTotal: entries.reduce((s, e) => s + e.salary, 0),
  };
}

/**
 * Refreshes the extraPaycheckRouting net-pay snapshot for jobs with routing configured,
 * only when `profileId` is the globally-active profile (a non-active edit must not
 * rewrite a plan). Returns the refreshed row, or undefined if nothing changed.
 */
async function refreshExtraPaycheckRoutingIfActive(
  { db, scope }: { db: typeof import("@/lib/db").db; scope: { asOf: Date } },
  profileId: number,
): Promise<typeof schema.salaryProfiles.$inferSelect | undefined> {
  try {
    const activeId = await resolveActiveSalaryProfileId(db);
    if (activeId !== profileId) return undefined;

    // Re-read the row in its own transaction: a caller's in-memory `salaries`
    // could clobber a concurrent patch to another job on the same profile.
    const refreshedRow = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.salaryProfiles)
        .where(eq(schema.salaryProfiles.id, profileId));
      const profile = rows[0];
      if (!profile) return undefined;

      const salaries = { ...checkSalaryEntries(profile).salaries };
      let anyRefreshed = false;
      for (const [jobIdStr, entry] of Object.entries(salaries)) {
        const routing = entry.extraPaycheckRouting;
        if (!routing?.rules?.length) continue; // a refused entry is read as stored
        const jobId = Number(jobIdStr);
        const refreshed = await computeJobNetPayPerCheck(tx, jobId, scope.asOf);
        salaries[jobIdStr] = {
          ...entry,
          extraPaycheckRouting: {
            ...routing,
            baseNetPayPerCheck: refreshed.netPayPerCheck,
            payPeriod: refreshed.payPeriod,
            anchorPayDate: refreshed.anchorPayDate,
          },
        };
        anyRefreshed = true;
      }
      if (!anyRefreshed) return undefined;

      const [refreshedRow] = await tx
        .update(schema.salaryProfiles)
        .set({ salaries })
        .where(eq(schema.salaryProfiles.id, profileId))
        .returning();
      return refreshedRow;
    });
    // A new net pay per check changes what the routing rules put into each
    // fund, so the planned transactions they generate follow — as
    // extraPaycheckRouting.save does.
    if (refreshedRow) await materializeExtraPaycheckSavings(db, scope.asOf);
    return refreshedRow;
  } catch (err) {
    // The caller's actual edit (already written before this runs) must not
    // fail just because the best-effort routing-snapshot refresh couldn't
    // resolve (e.g. a mid-edit state with no matching tax bracket yet).
    log("warn", "salary_profile_routing_refresh_failed", {
      profileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * w4FilingStatus + w4Box2cChecked form a composite key into the federal withholding
 * bracket table; validated at write time so a mismatch is never persisted (RULES.md).
 */
async function assertSalaryEntryTaxBracketsExist(
  { db, scope }: { db: typeof import("@/lib/db").db; scope: { asOf: Date } },
  salaries: SalaryEntryMap | undefined,
): Promise<void> {
  const entries = Object.entries(salaries ?? {});
  if (entries.length === 0) return;
  const taxYear = scope.asOf.getFullYear();
  const brackets = await db
    .select({
      filingStatus: schema.taxBrackets.filingStatus,
      w4Checkbox: schema.taxBrackets.w4Checkbox,
    })
    .from(schema.taxBrackets)
    .where(eq(schema.taxBrackets.taxYear, taxYear));
  const bracketKeys = new Set(
    brackets.map((b) => `${b.filingStatus}|${b.w4Checkbox}`),
  );

  for (const [jobId, entry] of entries) {
    if (!bracketKeys.has(`${entry.w4FilingStatus}|${entry.w4Box2cChecked}`)) {
      // Missing reference data, not a user mistake — BAD_REQUEST is skipped
      // by errorLoggingMiddleware, so log it explicitly.
      log("error", "tax_brackets_missing", {
        taxYear,
        filingStatus: entry.w4FilingStatus,
        box2c: entry.w4Box2cChecked,
      });
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `No tax bracket data found for filing status "${entry.w4FilingStatus}" ` +
          `(multiple jobs: ${entry.w4Box2cChecked}) for tax year ${taxYear} — ` +
          `cannot save this entry for job ${jobId}.`,
      });
    }
  }
}

export const salaryProfileRouter = createTRPCRouter({
  /** All salary profiles, oldest first. Real rows only. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select()
      .from(schema.salaryProfiles)
      .orderBy(schema.salaryProfiles.createdAt);

    return profiles.map((p) => {
      const salaries = checkSalaryEntries(p).salaries;
      const { pinnedCount, pinnedSalaryTotal } = summarizeEntries(salaries);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
        salaries,
        pinnedCount,
        pinnedSalaryTotal,
      };
    });
  }),

  /**
   * One profile plus per-person resolved rows, so the editor can show what
   * this profile actually produces for each job without a second round trip.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const profile = await fetchSalaryProfile(ctx.db, input.id);
      if (!profile) return null;

      const salaries = profile.salaries;
      const salaryProfileActiveMap = new Map(
        Object.entries(salaries).map(([jobId, entry]) => [
          Number(jobId),
          entry,
        ]),
      );
      const [people, allJobs, allEarnings] = await Promise.all([
        ctx.db.select().from(schema.people),
        ctx.db.select().from(schema.jobs),
        ctx.db.select().from(schema.paycheckEarnings),
      ]);

      /** An entry's salary fields over the blank entry, then where its
       *  bonus goes (absent = the budget). `otherEarnings` isn't one: it
       *  comes back per line as `earningRows`. */
      const entryFields = (entry: SalaryEntry | null) => {
        const {
          bonusDestination,
          otherEarnings: _,
          ...fields
        }: Partial<SalaryEntry> = entry ?? {};
        return {
          ...BLANK_SALARY_ENTRY,
          ...fields,
          bonusDestination: bonusDestination ?? DEFAULT_BONUS_DESTINATION,
        };
      };

      /** Full per-job detail for the selected job AND every other job in the row's
       *  job picker, so the client can switch jobs with no second round trip. */
      const jobDetail = (job: (typeof allJobs)[number]) => {
        const entry = salaries[String(job.id)] ?? null;
        const comp = resolveCompensation(salaryProfileActiveMap, job.id);
        return {
          id: job.id,
          employerName: job.employerName,
          startDate: job.startDate,
          endDate: job.endDate,
          /** Whether this profile has a complete entry for this job at all —
           *  the whole encoding. No entry means $0/no bonus, not a fallback
           *  to some other value. */
          hasEntry: entry !== null,
          /** The entry's fields, or BLANK_SALARY_ENTRY's as an editor starting point
           *  only (a job with no entry resolves to $0/incomplete everywhere else). */
          ...entryFields(entry),
          /** This job's other-pay lines with their per-check amount in this
           *  profile (0 when it sets none) — same as the Paycheck page. */
          earningRows: allEarnings
            .filter((e) => e.jobId === job.id)
            .map((e) => ({
              ...e,
              amount: entry?.otherEarnings?.[String(e.id)] ?? 0,
            })),
          /** What this profile actually produces for this job — the pinned
           *  actual when set, else the formula estimate. */
          effectiveSalary: comp.salary,
          estimatedBonus: comp.bonusOverride ?? comp.bonus,
          /** The formula's bonus, ignoring this year's actual. */
          formulaBonus: comp.bonus,
        };
      };

      const salaryDetails = people.map((person) => {
        const personJobs = allJobs
          .filter((j) => j.personId === person.id)
          .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
        const jobOptions = personJobs.map(jobDetail);
        // Target the job that already has an entry in this profile, else the person's
        // current active job; speculative jobs (endDate null too) are never the default.
        const withEntry = jobOptions.find(
          (jo, i) => !personJobs[i]!.isSpeculative && jo.hasEntry,
        );
        const activeOption = jobOptions.find(
          (jo, i) =>
            personJobs[i]!.endDate === null && !personJobs[i]!.isSpeculative,
        );
        const selected = withEntry ?? activeOption ?? null;
        return {
          personId: person.id,
          personName: person.name,
          /** The job this row targets — the real identity of an entry, not
           *  personId. Null when this person has no jobs at all yet. */
          jobId: selected?.id ?? null,
          /** This person's full job history, with resolved values
           *  precomputed for each — the row's job picker. */
          jobOptions,
          employerName: selected?.employerName ?? null,
          hasEntry: selected?.hasEntry ?? false,
          ...entryFields(
            selected ? (salaries[String(selected.id)] ?? null) : null,
          ),
          earningRows: selected?.earningRows ?? [],
          /** What this profile actually produces for this person. */
          effectiveSalary: selected?.effectiveSalary ?? 0,
          estimatedBonus: selected?.estimatedBonus ?? 0,
          formulaBonus: selected?.formulaBonus ?? 0,
        };
      });

      /** Household income this profile produces: everyone's salary + bonus. */
      const combinedIncome = salaryDetails.reduce(
        (sum, sd) => sum + sd.effectiveSalary + sd.estimatedBonus,
        0,
      );

      return {
        ...profile,
        salaries,
        createdAt: profile.createdAt.toISOString(),
        salaryDetails,
        combinedIncome,
      };
    }),

  /**
   * Create a profile with EMPTY `salaries`: a new profile never inherits another's entries.
   */
  create: contributionProfileProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        salaries: salaryEntriesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSalaryEntryTaxBracketsExist(ctx, input.salaries);
      return createProfile(ctx.db, "salary", input);
    }),

  /**
   * Clone a profile's job entries into a new, inactive profile. Each entry's
   * `extraPaycheckRouting` is reset to `null`: it is a snapshot of the source's net pay,
   * and activating the clone would materialize transactions off it.
   */
  duplicate: contributionProfileProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(({ ctx, input }) => duplicateProfile(ctx.db, "salary", input)),

  update: contributionProfileProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullish(),
        salaries: salaryEntriesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.salaryProfiles)
        .where(eq(schema.salaryProfiles.id, input.id));
      if (!existing[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found",
        });

      await assertSalaryEntryTaxBracketsExist(ctx, input.salaries);

      const updates: Partial<typeof schema.salaryProfiles.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description ?? null;
      if (input.salaries !== undefined) updates.salaries = input.salaries;

      const rows = await ctx.db
        .update(schema.salaryProfiles)
        .set(updates)
        .where(eq(schema.salaryProfiles.id, input.id))
        .returning();
      const updated = rows[0]!;

      if (input.salaries !== undefined) {
        const refreshed = await refreshExtraPaycheckRoutingIfActive(
          ctx,
          input.id,
        );
        if (refreshed) return refreshed;
      }

      return updated;
    }),

  /**
   * Field-level patch of one job's entry (`unset` clears named keys); the merged result
   * must still be a complete entry. Read-merge-write runs in a transaction so
   * overlapping patches can't clobber each other. Also creates a new entry.
   */
  patchEntry: contributionProfileProcedure
    .input(
      z.object({
        id: z.number(),
        jobId: z.number(),
        fields: salaryEntrySchema.partial(),
        unset: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.salaryProfiles)
          .where(eq(schema.salaryProfiles.id, input.id));
        const profile = existing[0];
        if (!profile)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found",
          });

        const salaries = checkSalaryEntries(profile).salaries;
        const key = String(input.jobId);
        const mergedEntry: Record<string, unknown> = { ...salaries[key] };
        for (const field of input.unset ?? []) delete mergedEntry[field];
        Object.assign(mergedEntry, input.fields);

        const parsed = salaryEntrySchema.safeParse(mergedEntry);
        if (!parsed.success) {
          // Message only, no `cause` — trpc.ts's errorFormatter attaches a
          // `data.zodError` for any BAD_REQUEST caused by a ZodError, and
          // friendlyMutationError prefers that over this message.
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid salary entry after patch: ${parsed.error.issues[0]?.message}`,
          });
        }

        const nextSalaries = { ...salaries, [key]: parsed.data };
        await assertSalaryEntryTaxBracketsExist(
          { db: tx, scope: ctx.scope },
          { [key]: parsed.data },
        );

        const rows = await tx
          .update(schema.salaryProfiles)
          .set({ salaries: nextSalaries })
          .where(eq(schema.salaryProfiles.id, input.id))
          .returning();
        return rows[0]!;
      });

      const refreshed = await refreshExtraPaycheckRoutingIfActive(
        ctx,
        input.id,
      );
      return refreshed ?? updated;
    }),

  /**
   * Remove one job's entry from a profile entirely — it goes back to
   * contributing $0, the same as a job that was never added. Same
   * transactional read-merge-write pattern as patchEntry.
   */
  removeEntry: contributionProfileProcedure
    .input(
      z.object({
        id: z.number(),
        jobId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.salaryProfiles)
          .where(eq(schema.salaryProfiles.id, input.id));
        const profile = existing[0];
        if (!profile)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found",
          });

        const salaries = { ...checkSalaryEntries(profile).salaries };
        delete salaries[String(input.jobId)];

        const rows = await tx
          .update(schema.salaryProfiles)
          .set({ salaries })
          .where(eq(schema.salaryProfiles.id, input.id))
          .returning();
        return rows[0]!;
      });

      const refreshed = await refreshExtraPaycheckRoutingIfActive(
        ctx,
        input.id,
      );
      return refreshed ?? updated;
    }),

  /**
   * Delete a profile. Blocked when it's the last one, the globally-active one, or any
   * Plan still uses it (the scenarios FK is `set null`).
   */
  delete: contributionProfileProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) => deleteProfile(ctx.db, "salary", input.id)),

  /**
   * Mark a profile as the globally-active one, or clear the setting with `id: null`;
   * see contributionProfile.setActive for why it isn't settings.appSettings.upsert.
   */
  setActive: contributionProfileProcedure
    .input(z.object({ id: z.number().nullable() }))
    .mutation(({ ctx, input }) => setActiveProfile(ctx.db, "salary", input.id)),
});
