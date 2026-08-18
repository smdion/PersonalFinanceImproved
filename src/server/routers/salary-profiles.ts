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
import { salaryEntriesSchema } from "@/lib/db/json-schemas";
import { resolveCompensation } from "@/server/helpers";
import type { SalaryEntryMap } from "@/server/helpers";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

/** How much this profile specifies, for the list view's at-a-glance summary. */
function summarizeEntries(salaries: SalaryEntryMap) {
  const entries = Object.values(salaries ?? {});
  return {
    pinnedCount: entries.length,
    pinnedSalaryTotal: entries.reduce((s, e) => s + e.salary, 0),
  };
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
          /** What this profile actually produces for this job. */
          effectiveSalary: comp.salary,
          estimatedBonus: comp.bonus,
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
      return rows[0]!;
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
