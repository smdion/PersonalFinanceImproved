import { and, inArray, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { W4FilingStatus } from "@/lib/config/filing-status";
import type { Db } from "@/lib/db";
import {
  applySalaryProfileRow,
  type SalaryProfileActiveMap,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import {
  fetchSalaryProfile,
  resolveActiveSalaryProfileId,
} from "@/server/data/salaries";
import { DEFAULT_BONUS_DESTINATION } from "@/lib/config/enum-values";
import {
  BLANK_SALARY_ENTRY,
  type SalaryEntry,
} from "@/lib/db/shapes/salary-entry-defaults";

/**
 * Load a Salary Profile's job-targeted active-value map (SalaryProfileActiveMap); empty when the
 * id is null/undefined or the profile doesn't exist.
 */
export async function loadAndApplySalaryProfile(
  db: Db,
  salaryProfileId: number | undefined | null,
): Promise<SalaryProfileActiveMap> {
  const profile = await fetchSalaryProfile(db, salaryProfileId);
  return applySalaryProfileRow(profile);
}

/**
 * loadAndApplySalaryProfile, falling back to the active Salary Profile when
 * no id is given: for callers that aren't showing a profile of their own.
 */
export async function loadEffectiveSalaryProfile(
  db: Db,
  salaryProfileId: number | null | undefined,
): Promise<SalaryProfileActiveMap> {
  if (salaryProfileId != null) {
    return loadAndApplySalaryProfile(db, salaryProfileId);
  }
  const activeId = await resolveActiveSalaryProfileId(db);
  return activeId != null ? loadAndApplySalaryProfile(db, activeId) : new Map();
}

/**
 * W-4 filing status of the first of `personIds` with a non-speculative job in `asOf`'s year, from
 * the request's Salary Profile (What-If included) or the active one; null if none. Only a
 * stand-in for the household's filing status (a W-4 status is a withholding choice).
 */
export async function w4FilingStatusOf(
  db: Db,
  personIds: readonly number[],
  asOf: Date,
  salaryProfileActiveMap?: SalaryProfileActiveMap,
): Promise<W4FilingStatus | null> {
  if (personIds.length === 0) return null;
  // Jobs held this year: current ones, then any that ended this year
  // (latest first) — someone retired mid-year still filed that way.
  const yearStart = `${asOf.getFullYear()}-01-01`;
  const jobs = (
    await db
      .select({
        id: schema.jobs.id,
        personId: schema.jobs.personId,
        endDate: schema.jobs.endDate,
      })
      .from(schema.jobs)
      .where(
        and(
          inArray(schema.jobs.personId, [...personIds]),
          eq(schema.jobs.isSpeculative, false),
        ),
      )
  )
    .filter((j) => j.endDate == null || String(j.endDate) >= yearStart)
    .sort(
      (a, b) =>
        Number(a.endDate != null) - Number(b.endDate != null) ||
        String(b.endDate ?? "").localeCompare(String(a.endDate ?? "")),
    );
  if (jobs.length === 0) return null;
  const active =
    salaryProfileActiveMap ?? (await loadEffectiveSalaryProfile(db, null));
  for (const personId of personIds)
    for (const job of jobs.filter((j) => j.personId === personId)) {
      const status = active.get(job.id)?.w4FilingStatus;
      if (status) return status;
    }
  return null;
}

export async function loadSalaryProfileDetail(
  ctx: { db: Db },
  input: { id: number },
) {
  const profile = await fetchSalaryProfile(ctx.db, input.id);
  if (!profile) return null;

  const salaries = profile.salaries;
  const salaryProfileActiveMap = new Map(
    Object.entries(salaries).map(([jobId, entry]) => [Number(jobId), entry]),
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
      ...entryFields(selected ? (salaries[String(selected.id)] ?? null) : null),
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
}
