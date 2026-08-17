/**
 * Salary Profiles Router
 *
 * CRUD for named per-person salary sets — a first-class sibling of Budget
 * Profile and Contribution Profile. A Salary Profile answers "what if I
 * earned X"; a Contribution Profile answers "what if I contributed Y". The two
 * are independent pins: a Plan, a budget column, or a page dropdown can select
 * either, both, or neither.
 *
 * Every profile is an ordinary row. There is no synthetic id-0 entry and no
 * `isDefault` column: `list`/`getById` return real rows only, and an id that
 * doesn't resolve is an error, not a "use live salary" signal.
 *
 * A profile's content is a personId → entry map where each entry is an object
 * of OPTIONAL pins — `{salary?, bonusPercent?, bonusMultiplier?,
 * monthsInBonusYear?}`. Presence of a field is the pin signal; an absent
 * field resolves live from the job record on every read. An empty entry, or
 * no entry at all, pins nothing. There is no `mode` discriminator.
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
import {
  getCurrentSalary,
  getBonusOverridesForJobs,
  pinnedFields,
  resolveCompensation,
  toNumber,
} from "@/server/helpers";
import type { SalaryEntryMap } from "@/server/helpers";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * How much this profile pins, for the list view's at-a-glance summary.
 *
 * `pinnedCount` counts people with ANY pin (salary or bonus terms), so a
 * bonus-only profile doesn't read as empty. `pinnedSalaryTotal` sums only
 * pinned SALARIES — people whose salary resolves live keep their real
 * salary, so this is deliberately not the household total.
 */
function summarizeEntries(salaries: SalaryEntryMap) {
  const entries = Object.values(salaries ?? {})
    .map((e) => pinnedFields(e))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);
  return {
    pinnedCount: entries.length,
    pinnedSalaryTotal: entries.reduce((s, e) => s + (e.salary ?? 0), 0),
  };
}

/**
 * Drop entries that pin nothing before storing.
 *
 * Clients naturally send an entry per person (that is what their table
 * renders), and "unpin this field" arrives as a field simply not being set.
 * Left alone, that accumulates `{}` entries which mean the same as no key
 * but make every stored map look populated and make `pinnedCount` wrong.
 * Normalizing on write keeps one representation for one meaning.
 */
function normalizeSalaries(salaries: SalaryEntryMap): SalaryEntryMap {
  const out: SalaryEntryMap = {};
  for (const [personId, entry] of Object.entries(salaries)) {
    const pinned = pinnedFields(entry);
    if (pinned) out[personId] = pinned;
  }
  return out;
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
   * One profile plus per-person live salary rows, so the editor can show what
   * "follows job" currently resolves to without a second round trip.
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
      const [people, allJobs] = await Promise.all([
        ctx.db.select().from(schema.people),
        ctx.db.select().from(schema.jobs),
      ]);
      const asOfDate = new Date();
      const currentYear = asOfDate.getFullYear();
      const activeJobs = allJobs.filter((j) => !j.endDate);
      const bonusOverrides = await getBonusOverridesForJobs(
        ctx.db,
        activeJobs.map((j) => j.id),
      );

      const salaryDetails = await Promise.all(
        people.map(async (person) => {
          const job = activeJobs.find((j) => j.personId === person.id);
          const jobSalary = job
            ? await getCurrentSalary(ctx.db, job.id, job.annualSalary, asOfDate)
            : 0;
          // A person with no entry yet (added after the profile was created)
          // pins nothing — every field resolves live, the same default a new
          // profile starts from.
          const entry = pinnedFields(salaries[String(person.id)]);
          const resolvedBonusOverride = job
            ? (bonusOverrides.get(`${job.id}:${currentYear}`) ?? null)
            : null;
          // The SAME kernel resolveProfile and build-engine-payload use, so
          // the editor's preview cannot drift from the numbers the rest of
          // the app computes. It previously re-derived this and disagreed:
          // a pinned salary kept its bonus here while losing it everywhere
          // that mattered.
          const comp = job
            ? resolveCompensation(job, jobSalary, entry, resolvedBonusOverride)
            : { salary: entry?.salary ?? 0, bonus: 0, totalComp: 0 };
          return {
            personId: person.id,
            personName: person.name,
            employerName: job?.employerName ?? null,
            /** jobs.annual_salary as stored — the starting salary. */
            baseSalary: job ? toNumber(job.annualSalary) : 0,
            /** What an unpinned salary resolves to right now (salary_changes applied). */
            jobSalary,
            /** Live bonus terms off the job record — what the editor
             *  pre-fills a bonus field with when nothing is pinned. */
            jobBonusPercent: job ? toNumber(job.bonusPercent) : 0,
            jobBonusMultiplier: job ? toNumber(job.bonusMultiplier) || 1 : 1,
            jobMonthsInBonusYear: job?.monthsInBonusYear ?? 12,
            /** Per-field pins: null means "resolves live", a number means
             *  "this profile pins it". This is the whole encoding — there is
             *  no separate mode flag to read. */
            pinnedSalary: entry?.salary ?? null,
            pinnedBonusPercent: entry?.bonusPercent ?? null,
            pinnedBonusMultiplier: entry?.bonusMultiplier ?? null,
            pinnedMonthsInBonusYear: entry?.monthsInBonusYear ?? null,
            /** The salary this profile actually produces for this person. */
            effectiveSalary: comp.salary,
            /** Estimated annual bonus at this profile's salary and bonus
             *  terms — pinned where pinned, live otherwise. */
            estimatedBonus: comp.bonus,
          };
        }),
      );

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
   * Create a profile. `salaries` defaults to EMPTY — nothing pinned, every
   * person's salary and bonus resolving live. A new what-if profile must
   * never silently inherit and freeze whatever pins happened to be active
   * when it was made. Callers wanting "start from an existing profile" pass
   * that profile's map explicitly.
   *
   * Under the presence encoding an empty map is already complete: it says
   * "this profile pins nothing", which is exactly what a fresh profile
   * means. The old encoding had to enumerate every person to say the same
   * thing, and that enumeration then went stale whenever someone was added.
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
      const salaries = normalizeSalaries(input.salaries ?? {});
      const rows = await ctx.db
        .insert(schema.salaryProfiles)
        .values({
          name: input.name,
          description: input.description ?? null,
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

      const updates: Partial<typeof schema.salaryProfiles.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description ?? null;
      if (input.salaries !== undefined)
        updates.salaries = normalizeSalaries(input.salaries);

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
