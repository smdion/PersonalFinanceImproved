/**
 * Salary lookup and compensation helpers.
 */
import { eq, and, lte, gt, desc, asc } from "drizzle-orm";
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
  }[]
> {
  return Promise.all(
    jobs.map(async (job) => {
      const baseSalary = await getCurrentSalary(
        db,
        job.id,
        job.annualSalary,
        asOfDate,
      );
      const effectiveIncome = getEffectiveIncome(job, baseSalary);
      return { job, baseSalary, effectiveIncome };
    }),
  );
}

/**
 * Compute effective income for a job — salary + annual bonus when
 * includeBonusInContributions is true. Used for payroll contribution calculations
 * where the flag controls whether percent-of-salary deductions apply to bonus pay.
 */
export function getEffectiveIncome(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
): number {
  if (!job.includeBonusInContributions) return baseSalary;
  return getTotalCompensation(job, baseSalary);
}

/**
 * Compute savings rate: contributions / total compensation.
 * Always uses total compensation (includes bonus) as denominator — this is
 * what you actually earn, regardless of whether bonus is included in
 * percent-of-salary contribution calculations.
 *
 * Single source of truth for savings rate denominator across all pages
 * (dashboard checkup, contributions page, projection page, retirement router).
 */
export function computeSavingsRate(
  totalContributions: number,
  totalCompensation: number,
): number {
  return totalCompensation > 0 ? totalContributions / totalCompensation : 0;
}

/**
 * Compute total compensation (salary + bonus) regardless of the
 * includeBonusInContributions flag. Used for display and projection
 * purposes where total comp is always the relevant number.
 */
export function getTotalCompensation(
  job: typeof schema.jobs.$inferSelect,
  baseSalary: number,
): number {
  const bonus = computeBonusGross(
    baseSalary,
    job.bonusPercent,
    job.bonusMultiplier,
    job.bonusOverride,
    job.monthsInBonusYear,
  );
  return baseSalary + bonus;
}

/**
 * Compute gross bonus amount from job fields.
 * Formula: salary × bonusPercent × bonusMultiplier × (monthsInBonusYear / 12).
 * If bonusOverride is set, returns that directly.
 */
export function computeBonusGross(
  salary: number,
  bonusPercent: string | null,
  bonusMultiplier: string | null,
  bonusOverride: string | null,
  monthsInBonusYear: number | null,
): number {
  if (bonusOverride) return roundToCents(toNumber(bonusOverride));
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
