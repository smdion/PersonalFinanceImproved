/**
 * Salary Profiles Router
 *
 * CRUD for named per-job salary sets — a first-class sibling of Budget
 * Profile and Contribution Profile. A Salary Profile answers "what if I
 * earned X"; a Contribution Profile answers "what if I contributed Y". The
 * two are independent pins: a Plan, a budget column, or a page dropdown can
 * select either, both, or neither.
 *
 * Every profile is an ordinary row. There is no synthetic id-0 entry and no
 * `isDefault` column: `list`/`getById` return real rows only, and an id that
 * doesn't resolve is an error.
 *
 * A profile's content is a jobId → entry map where each entry is COMPLETE —
 * `{salary, bonusPercent, bonusMultiplier, monthsInBonusYear}`, all four,
 * always. A job either has a real, self-contained number in this profile,
 * or (no key at all) the profile says nothing about it — never a partial
 * pin, never a fallback to "the job's live value" (a job has none). A
 * profile is its own complete world; if you want different numbers, make a
 * different profile.
 *
 * Keyed by jobId, not personId: a profile targets a SPECIFIC job's terms,
 * not "whichever job this person currently has" — see getById's job-picker
 * (jobOptions) below for how a row can target a past job instead of the
 * current active one.
 *
 * Bonus terms live here rather than on a Contribution Profile: "how big is
 * the bonus" is the same category of fact as "how big is the salary". A
 * Contribution Profile still owns include401kInBonus /
 * includeBonusInContributions, which describe how contributions are computed
 * FROM a bonus.
 *
 * Permissions intentionally mirror contributionProfile (no new gate): reads on
 * protectedProcedure, writes on contributionProfileProcedure.
 */
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { createTRPCRouter } from "../trpc";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { canDeleteSalaryProfile } from "@/lib/pure/profiles";
import { salaryEntriesSchema, salaryEntrySchema } from "@/lib/db/json-schemas";
import { resolveCompensation } from "@/server/helpers";
import type { SalaryEntryMap } from "@/server/helpers";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import { resolveActiveSalaryProfileId } from "@/server/helpers/salary";
import { computeJobNetPayPerCheck } from "./savings";

/** How much this profile specifies, for the list view's at-a-glance summary. */
function summarizeEntries(salaries: SalaryEntryMap) {
  const entries = Object.values(salaries ?? {});
  return {
    pinnedCount: entries.length,
    pinnedSalaryTotal: entries.reduce((s, e) => s + e.salary, 0),
  };
}

/**
 * Refresh extraPaycheckRouting's baseNetPayPerCheck/payPeriod/anchorPayDate
 * snapshot for any job whose routing is already configured — but only when
 * `profileId` is the globally-ACTIVE profile. Editing an active profile's
 * real values (a withholding correction, a raise) is not "browsing a
 * what-if" — it's a correction to the one real number
 * computeJobNetPayPerCheck already resolves against, so it should
 * propagate immediately, the same way an explicit
 * extraPaycheckRouting.save/saveGrowth would. Editing a NON-active profile
 * must NOT trigger this — that's exactly the "routine profile switch
 * silently rewrites a plan" case RULES.md's no-cascade-by-design note
 * warns about; the distinction is active-vs-not, not edited-vs-not.
 *
 * Single computation path for this refresh — called from every mutation
 * that can change a profile's `salaries` (update, patchEntry, removeEntry)
 * instead of each reimplementing it.
 *
 * Returns the refreshed row, or undefined if nothing needed refreshing
 * (not active, or no job had routing configured).
 */
async function refreshExtraPaycheckRoutingIfActive(
  db: typeof import("@/lib/db").db,
  profileId: number,
  salaries: SalaryEntryMap,
): Promise<typeof schema.salaryProfiles.$inferSelect | undefined> {
  try {
    const activeId = await resolveActiveSalaryProfileId(db);
    if (activeId !== profileId) return undefined;

    let anyRefreshed = false;
    for (const [jobIdStr, entry] of Object.entries(salaries)) {
      const routing = entry.extraPaycheckRouting;
      if (!routing?.rules?.length) continue;
      const jobId = Number(jobIdStr);
      const refreshed = await computeJobNetPayPerCheck(db, jobId);
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

    const [refreshedRow] = await db
      .update(schema.salaryProfiles)
      .set({ salaries })
      .where(eq(schema.salaryProfiles.id, profileId))
      .returning();
    return refreshedRow;
  } catch {
    // The caller's actual edit (already written before this runs) must not
    // fail just because the best-effort routing-snapshot refresh couldn't
    // resolve (e.g. a mid-edit state with no matching tax bracket yet).
    return undefined;
  }
}

/**
 * w4FilingStatus + w4Box2cChecked form a composite key into the federal
 * withholding bracket table. A Salary Profile entry is complete-or-absent
 * (see salaryEntrySchema) — every entry being written always sets both
 * halves together, unlike the old Contribution-Profile-jobs-bucket design
 * this replaces (moved here from contribution-profiles.ts's
 * assertJobTaxBracketsExist, now checking every entry unconditionally
 * rather than only entries that patch one half). Validating at write time
 * — rather than deferring to a read-time error that could surface during
 * an unrelated computation — is a hard requirement per RULES.md: a
 * composite-key mismatch should never be persisted in the first place.
 */
async function assertSalaryEntryTaxBracketsExist(
  db: typeof import("@/lib/db").db,
  salaries: SalaryEntryMap | undefined,
): Promise<void> {
  const entries = Object.entries(salaries ?? {});
  if (entries.length === 0) return;

  const taxYear = new Date().getFullYear();
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
      throw new Error(
        `No tax bracket data found for filing status "${entry.w4FilingStatus}" ` +
          `(multiple jobs: ${entry.w4Box2cChecked}) for tax year ${taxYear} — ` +
          `cannot save this entry for job ${jobId}.`,
      );
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
      const salaries = (p.salaries ?? {}) as SalaryEntryMap;
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
      const rows = await ctx.db
        .select()
        .from(schema.salaryProfiles)
        .where(eq(schema.salaryProfiles.id, input.id));
      const profile = rows[0];
      if (!profile) return null;

      const salaries = (profile.salaries ?? {}) as SalaryEntryMap;
      const salaryProfileActiveMap = new Map(
        Object.entries(salaries).map(([jobId, entry]) => [
          Number(jobId),
          entry,
        ]),
      );
      const [people, allJobs] = await Promise.all([
        ctx.db.select().from(schema.people),
        ctx.db.select().from(schema.jobs),
      ]);

      /** Full per-job detail — computed once per job so both the selected
       *  row AND every OTHER job in that person's jobOptions (the row's job
       *  picker) carry real resolved values, not just the display name.
       *  Lets the client switch which job a row targets with no second
       *  round trip. */
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
          salary: entry?.salary ?? 0,
          bonusPercent: entry?.bonusPercent ?? 0,
          bonusMultiplier: entry?.bonusMultiplier ?? 1,
          monthsInBonusYear: entry?.monthsInBonusYear ?? 12,
          /** This year's actual paid-out bonus, pinned on the same entry —
           *  see SalaryProfileEntry.bonusOverride's docblock. */
          bonusOverride: entry?.bonusOverride ?? null,
          /** Pay schedule, W-4 elections, and bonus pay date/flags — the 11
           *  fields that moved off `jobs` in Stage B. Defaults below match
           *  onboarding-wizard.tsx's defaults for a brand-new entry, purely
           *  a visible starting point for the editor when this job has no
           *  entry yet — never used in any live calculation (a job with no
           *  entry resolves to $0/incomplete everywhere else). */
          payPeriod: entry?.payPeriod ?? "biweekly",
          payWeek: entry?.payWeek ?? "na",
          anchorPayDate: entry?.anchorPayDate ?? null,
          budgetPeriodsPerMonth: entry?.budgetPeriodsPerMonth ?? null,
          w4FilingStatus: entry?.w4FilingStatus ?? "MFJ",
          w4Box2cChecked: entry?.w4Box2cChecked ?? false,
          additionalFedWithholding: entry?.additionalFedWithholding ?? 0,
          bonusMonth: entry?.bonusMonth ?? null,
          bonusDayOfMonth: entry?.bonusDayOfMonth ?? null,
          include401kInBonus: entry?.include401kInBonus ?? false,
          includeBonusInContributions:
            entry?.includeBonusInContributions ?? false,
          /** Where this job's extra (3rd biweekly) paycheck routes, if
           *  configured — see extraPaycheckRoutingSchema (json-schemas.ts). */
          extraPaycheckRouting: entry?.extraPaycheckRouting ?? null,
          /** What this profile actually produces for this job — the pinned
           *  actual when set, else the formula estimate. */
          effectiveSalary: comp.salary,
          estimatedBonus: comp.bonusOverride ?? comp.bonus,
        };
      };

      const salaryDetails = people.map((person) => {
        const personJobs = allJobs
          .filter((j) => j.personId === person.id)
          .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
        const jobOptions = personJobs.map(jobDetail);
        // Which job this row targets: whichever job already has an entry in
        // this profile (so reopening a profile that targets a past job
        // keeps showing that job selected), else this person's current
        // active job. A speculative job also has endDate: null (it never
        // "ends") but must never be the default pick when a real active job
        // exists — excluded from both branches.
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
          salary: selected?.salary ?? 0,
          bonusPercent: selected?.bonusPercent ?? 0,
          bonusMultiplier: selected?.bonusMultiplier ?? 1,
          monthsInBonusYear: selected?.monthsInBonusYear ?? 12,
          bonusOverride: selected?.bonusOverride ?? null,
          payPeriod: selected?.payPeriod ?? "biweekly",
          payWeek: selected?.payWeek ?? "na",
          anchorPayDate: selected?.anchorPayDate ?? null,
          budgetPeriodsPerMonth: selected?.budgetPeriodsPerMonth ?? null,
          w4FilingStatus: selected?.w4FilingStatus ?? "MFJ",
          w4Box2cChecked: selected?.w4Box2cChecked ?? false,
          additionalFedWithholding: selected?.additionalFedWithholding ?? 0,
          bonusMonth: selected?.bonusMonth ?? null,
          bonusDayOfMonth: selected?.bonusDayOfMonth ?? null,
          include401kInBonus: selected?.include401kInBonus ?? false,
          includeBonusInContributions:
            selected?.includeBonusInContributions ?? false,
          extraPaycheckRouting: selected?.extraPaycheckRouting ?? null,
          /** What this profile actually produces for this person. */
          effectiveSalary: selected?.effectiveSalary ?? 0,
          estimatedBonus: selected?.estimatedBonus ?? 0,
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
   * Create a profile. `salaries` defaults to EMPTY — genuinely no job
   * entries, not copied from any other profile. A new what-if profile must
   * never silently inherit whatever another profile happened to say —
   * that's the entire point of a profile being its own complete world.
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
      await assertSalaryEntryTaxBracketsExist(ctx.db, input.salaries);

      const rows = await ctx.db
        .insert(schema.salaryProfiles)
        .values({
          name: input.name,
          description: input.description ?? null,
          salaries: input.salaries ?? {},
        })
        .returning();
      return rows[0]!;
    }),

  /**
   * Clone an existing profile's job entries into a new, inactive profile.
   *
   * Every entry's `extraPaycheckRouting` is reset to `null` (a valid,
   * complete value — see salaryEntrySchema) rather than copied verbatim.
   * That field is a RECORDED FACT — baseNetPayPerCheck/payPeriod/
   * anchorPayDate snapshotted from whichever profile was active at save
   * time — not a formula. Copying it verbatim would let the clone inherit
   * the source's frozen net-pay figure; activating the clone (the entire
   * reason someone clones a profile) would then immediately materialize
   * real savings_planned_transactions off a stale, wrong number with no
   * error surfaced — `update`'s active-profile-only refresh (below) never
   * fires for a profile that isn't active yet. The user reconfigures
   * routing on the clone afterward, which resolves correctly.
   */
  duplicate: contributionProfileProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db
        .select()
        .from(schema.salaryProfiles)
        .where(eq(schema.salaryProfiles.id, input.sourceProfileId))
        .then((r) => r[0]);
      if (!source) throw new Error("Source profile not found");

      const sourceSalaries = (source.salaries ?? {}) as SalaryEntryMap;
      const salaries: SalaryEntryMap = Object.fromEntries(
        Object.entries(sourceSalaries).map(([jobId, entry]) => [
          jobId,
          { ...entry, extraPaycheckRouting: null },
        ]),
      );

      const rows = await ctx.db
        .insert(schema.salaryProfiles)
        .values({
          name: input.name,
          description: source.description,
          salaries,
        })
        .returning();
      return rows[0]!;
    }),

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
      if (!existing[0]) throw new Error("Profile not found");

      await assertSalaryEntryTaxBracketsExist(ctx.db, input.salaries);

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
          ctx.db,
          input.id,
          updated.salaries as SalaryEntryMap,
        );
        if (refreshed) return refreshed;
      }

      return updated;
    }),

  /**
   * Patch (merge) one job's entry within a profile — a true field-level
   * patch, not a client-side-merged full-blob replace. `fields` only needs
   * to carry the keys actually changing; `unset` explicitly names keys to
   * clear back to their type's "unset" value where meaningful (most fields
   * here don't have one — see the merged-result validation below, which
   * requires every field to still resolve to a complete entry after the
   * patch). Also used to create a brand-new entry by passing a complete
   * `fields` object (e.g. BLANK_ENTRY) with no existing entry to merge
   * onto.
   *
   * The read-merge-write happens inside a transaction so two overlapping
   * patches to the same profile (two fields committed in quick succession,
   * a second tab/device) can't silently clobber each other the way the
   * previous design — read a snapshot client-side, merge client-side, PUT
   * the whole blob back through `update` — could.
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
        if (!profile) throw new Error("Profile not found");

        const salaries = profile.salaries as SalaryEntryMap;
        const key = String(input.jobId);
        const mergedEntry: Record<string, unknown> = { ...salaries[key] };
        for (const field of input.unset ?? []) delete mergedEntry[field];
        Object.assign(mergedEntry, input.fields);

        const parsed = salaryEntrySchema.safeParse(mergedEntry);
        if (!parsed.success) {
          throw new Error(
            `Invalid salary entry after patch: ${parsed.error.issues[0]?.message}`,
          );
        }

        const nextSalaries = { ...salaries, [key]: parsed.data };
        await assertSalaryEntryTaxBracketsExist(tx, {
          [key]: parsed.data,
        });

        const rows = await tx
          .update(schema.salaryProfiles)
          .set({ salaries: nextSalaries })
          .where(eq(schema.salaryProfiles.id, input.id))
          .returning();
        return rows[0]!;
      });

      const refreshed = await refreshExtraPaycheckRoutingIfActive(
        ctx.db,
        input.id,
        updated.salaries as SalaryEntryMap,
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
        if (!profile) throw new Error("Profile not found");

        const salaries = { ...(profile.salaries as SalaryEntryMap) };
        delete salaries[String(input.jobId)];

        const rows = await tx
          .update(schema.salaryProfiles)
          .set({ salaries })
          .where(eq(schema.salaryProfiles.id, input.id))
          .returning();
        return rows[0]!;
      });

      const refreshed = await refreshExtraPaycheckRoutingIfActive(
        ctx.db,
        input.id,
        updated.salaries as SalaryEntryMap,
      );
      return refreshed ?? updated;
    }),

  /**
   * Delete a profile. Blocked when it's the last one left (the active-profile
   * setting must always resolve to a real row), when it's the globally-active
   * selection, and when any Plan still pins it — the scenarios FK is
   * `set null`, so without that check deleting would silently unpin every
   * Plan referencing it.
   */
  delete: contributionProfileProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const activeSettingRows = await ctx.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID));
      const activeId = (activeSettingRows[0]?.value ?? null) as number | null;

      const allProfiles = await ctx.db
        .select({ id: schema.salaryProfiles.id })
        .from(schema.salaryProfiles);

      const deleteCheck = canDeleteSalaryProfile(
        activeId,
        input.id,
        allProfiles.length,
      );
      if (!deleteCheck.allowed) throw new Error(deleteCheck.reason);

      if (!allProfiles.some((p) => p.id === input.id))
        throw new Error("Profile not found");

      const pinningPlans = await ctx.db
        .select({ name: schema.scenarios.name })
        .from(schema.scenarios)
        .where(eq(schema.scenarios.salaryProfileId, input.id));
      if (pinningPlans.length > 0) {
        throw new Error(
          `Cannot delete: pinned by ${pinningPlans.length} Plan(s) (${pinningPlans
            .map((p) => p.name)
            .join(", ")}). Unpin it there first.`,
        );
      }

      await ctx.db
        .delete(schema.salaryProfiles)
        .where(eq(schema.salaryProfiles.id, input.id));
      return { success: true };
    }),
});
