/**
 * Salary lookup and compensation helpers.
 */
import { eq, and, lte, gte, gt, desc, asc, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "./transforms";
import type { Db } from "./transforms";

/**
 * Get the current salary for a job by checking salary_changes first,
 * falling back to jobs.annual_salary if no changes exist.
 * Per Migration Plan section 12.27.
 */
export async function getCurrentSalary(
  db: Db,
  jobId: number,
  fallbackSalary: string,
  asOfDate: Date = new Date(),
): Promise<number> {
  const changes = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        lte(
          schema.salaryChanges.effectiveDate,
          asOfDate.toISOString().slice(0, 10),
        ),
      ),
    )
    .orderBy(desc(schema.salaryChanges.effectiveDate))
    .limit(1);

  if (changes.length > 0 && changes[0]) {
    return toNumber(changes[0].newSalary);
  }
  return toNumber(fallbackSalary);
}

/**
 * Apply a salary override map to an already-resolved raw salary — the
 * single "final merge" step (`override ?? raw`) that used to be re-typed
 * inline at every call site. Use this when the caller already has the raw
 * salary in hand for another purpose (e.g. also needs it un-overridden for
 * total-compensation math); use resolveEffectiveSalary below when it
 * doesn't and would otherwise fetch it just to throw it away.
 *
 * The map itself should already be the merged Plan+Contribution-Profile
 * map from loadAndApplyContribProfile (Plan wins if both are set) — this
 * function doesn't decide Plan vs. Profile precedence, only applies
 * whatever map it's handed.
 *
 * Whether a call site should PASS a populated map at all is a separate
 * decision: pass one when the output is presented as "what your finances
 * look like under the active Plan" (paycheck, budget item $ amounts); pass
 * an empty map when the output is a persisted snapshot or the live/control
 * arm of a comparison (see savings.ts's computeJobNetPayPerCheck,
 * retirement.ts's computeRelocationAnalysis, and this file's
 * loadLiveContribData for documented examples of the latter — overriding
 * those would corrupt what they're for, not fix them).
 */
export function applySalaryOverride(
  personId: number,
  rawSalary: number,
  salaryOverrideMap: Map<number, number>,
): number {
  return salaryOverrideMap.get(personId) ?? rawSalary;
}

/**
 * Resolve a job's effective salary end to end: fetches the raw current
 * salary (salary_changes history, falling back to jobs.annual_salary) and
 * applies applySalaryOverride to it. See applySalaryOverride's docblock for
 * the full precedence contract and when a call site should/shouldn't pass
 * a populated override map.
 */
export async function resolveEffectiveSalary(
  db: Db,
  job: { id: number; personId: number; annualSalary: string },
  salaryOverrideMap: Map<number, number>,
  asOfDate: Date = new Date(),
): Promise<number> {
  const raw = await getCurrentSalary(db, job.id, job.annualSalary, asOfDate);
  return applySalaryOverride(job.personId, raw, salaryOverrideMap);
}

/**
 * Fetch current salary + effective income for a list of jobs.
 * Replaces the duplicated `Promise.all(jobs.map(j => getCurrentSalary(...)))` pattern
 * across paycheck, contribution, networth, retirement, and historical routers.
 */
export async function getSalariesForJobs(
  db: Db,
  jobs: (typeof schema.jobs.$inferSelect)[],
  asOfDate: Date = new Date(),
): Promise<
  {
    job: typeof schema.jobs.$inferSelect;
    baseSalary: number;
    effectiveIncome: number;
    /** This job's bonus override for asOfDate's calendar year, if any —
     *  exposed so callers that also need getTotalCompensation don't have to
     *  re-fetch it themselves. */
    resolvedBonusOverride: number | null;
  }[]
> {
  const bonusOverrides = await getBonusOverridesForJobs(
    db,
    jobs.map((j) => j.id),
  );
  const year = asOfDate.getFullYear();
  return Promise.all(
    jobs.map(async (job) => {
      const baseSalary = await getCurrentSalary(
        db,
        job.id,
        job.annualSalary,
        asOfDate,
      );
      const resolvedBonusOverride =
        bonusOverrides.get(`${job.id}:${year}`) ?? null;
      const effectiveIncome = getEffectiveIncome(
        job,
        baseSalary,
        resolvedBonusOverride,
      );
      return { job, baseSalary, effectiveIncome, resolvedBonusOverride };
    }),
  );
}

/**
 * Fetch every bonus override row for the given jobs, across all years,
 * keyed `"${jobId}:${year}"`. Batched (one query) rather than per-job so
 * callers that need multiple years for the same job set (e.g. historical.ts's
 * per-year reconstruction loop) don't re-query per year.
 */
export async function getBonusOverridesForJobs(
  db: Db,
  jobIds: number[],
): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.jobBonusOverrides)
    .where(inArray(schema.jobBonusOverrides.jobId, jobIds));
  return new Map(
    rows.map((r) => [`${r.jobId}:${r.year}`, toNumber(r.overrideAmount)]),
  );
}

/**
 * Compute effective income for a job — salary + annual bonus when
 * includeBonusInContributions is true. Used for payroll contribution calculations
 * where the flag controls whether percent-of-salary deductions apply to bonus pay.
 *
 * `resolvedBonusOverride` must be resolved by the caller for the specific
 * year in question (via getBonusOverridesForJobs) — there is no shared
 * fallback the way the old flat jobs.bonus_override column had, so passing
 * the wrong year's value (or always-current when a past/future year is
 * intended) silently produces the wrong number.
 */
export function getEffectiveIncome(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
  resolvedBonusOverride: number | null,
): number {
  if (!job.includeBonusInContributions) return baseSalary;
  return getTotalCompensation(job, baseSalary, resolvedBonusOverride);
}

/**
 * Compute total compensation (salary + bonus) regardless of the
 * includeBonusInContributions flag. Used for display and projection
 * purposes where total comp is always the relevant number.
 *
 * See getEffectiveIncome's docblock for the `resolvedBonusOverride` contract.
 */
export function getTotalCompensation(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
  resolvedBonusOverride: number | null,
): number {
  const bonus = computeBonusGross(
    baseSalary,
    job.bonusPercent,
    job.bonusMultiplier,
    resolvedBonusOverride,
    job.monthsInBonusYear,
  );
  return baseSalary + bonus;
}

/**
 * Compute gross bonus amount from job fields.
 * Formula: salary × bonusPercent × bonusMultiplier × (monthsInBonusYear / 12).
 * If bonusOverride is set (including explicitly to 0), returns that directly.
 */
export function computeBonusGross(
  salary: number,
  bonusPercent: string | null,
  bonusMultiplier: string | null,
  bonusOverride: number | null,
  monthsInBonusYear: number | null,
): number {
  if (bonusOverride !== null) return roundToCents(bonusOverride);
  const pct = toNumber(bonusPercent);
  if (pct <= 0) return 0;
  const mult = toNumber(bonusMultiplier) || 1;
  const months = monthsInBonusYear ?? 12;
  return roundToCents(salary * pct * mult * (months / 12));
}

/**
 * Get the next upcoming salary change for a job (effective date > asOfDate).
 * Returns null if no future change is scheduled.
 */
export async function getFutureSalaryChanges(
  db: Db,
  jobId: number,
  asOfDate: Date = new Date(),
): Promise<{ salary: number; effectiveDate: string }[]> {
  const changes = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        gt(
          schema.salaryChanges.effectiveDate,
          asOfDate.toISOString().slice(0, 10),
        ),
      ),
    )
    .orderBy(asc(schema.salaryChanges.effectiveDate));

  return changes.map((c: { newSalary: string; effectiveDate: string }) => ({
    salary: toNumber(c.newSalary),
    effectiveDate: c.effectiveDate,
  }));
}

/**
 * Get the full salary timeline for a job within a given year.
 * Returns entries in date order, starting with the rate effective on Jan 1
 * (from most recent change before the year, or job base salary as fallback),
 * followed by all changes within the year (past + future).
 */
export async function getSalaryTimelineForYear(
  db: Db,
  jobId: number,
  fallbackSalary: string,
  year: number,
): Promise<{ salary: number; effectiveDate: string | null }[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Starting salary: most recent change before Jan 1 of the target year
  const startingSalary = await getCurrentSalary(
    db,
    jobId,
    fallbackSalary,
    new Date(`${year}-01-01T00:00:00`),
  );

  // All changes within the target year (both past and future)
  const changesInYear = await db
    .select()
    .from(schema.salaryChanges)
    .where(
      and(
        eq(schema.salaryChanges.jobId, jobId),
        gte(schema.salaryChanges.effectiveDate, yearStart),
        lte(schema.salaryChanges.effectiveDate, yearEnd),
      ),
    )
    .orderBy(asc(schema.salaryChanges.effectiveDate));

  const timeline: { salary: number; effectiveDate: string | null }[] = [
    { salary: startingSalary, effectiveDate: null },
  ];

  for (const c of changesInYear) {
    timeline.push({
      salary: toNumber(c.newSalary),
      effectiveDate: c.effectiveDate,
    });
  }

  return timeline;
}
