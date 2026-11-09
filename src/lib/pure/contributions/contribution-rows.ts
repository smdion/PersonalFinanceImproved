/** A contribution row in yearly dollars, and the job its pay comes from. */
import { safeDivide } from "@/lib/utils/math";
import type { AccountCategory } from "@/lib/config/account-types";
import { computeValue } from "./contribution-caps";
import {
  computeAnnualContribution,
  fractionFromPercent,
} from "./contribution-amount";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import {
  bonusCheckContribution,
  isPaidThroughPayroll,
} from "@/lib/pure/paycheck/bonus";
import { matchPayGroupsWithBonus, matchGroupKey } from "./employer-match";

/**
 * Jobless account fallback: the active jobs' periods per year, or `incomplete: true` with none
 * or with mixed schedules (`periodsPerYear` is then a placeholder). Shared by
 * computeActiveSummary and its inverse, applyContributionAccountEdit.
 */
export function resolveJoblessPeriodsPerYear(
  activeJobs: { payPeriod: string | undefined }[],
): { periodsPerYear: number; incomplete: boolean } {
  const schedules = new Set(
    activeJobs.flatMap((j) => (j.payPeriod != null ? [j.payPeriod] : [])),
  );
  const [first] = schedules;
  return first !== undefined
    ? {
        periodsPerYear: getPeriodsPerYear(first),
        incomplete: schedules.size > 1,
      }
    : { periodsPerYear: 0, incomplete: true };
}

/**
 * A row's periods per year from its resolved `job` (undefined = none). Only `fixed_per_period`
 * uses it for its yearly amount, so only it can be incomplete; others resolve `0`, which
 * callers must not divide by.
 */
export function resolveContributionPeriods(
  method: string,
  job: { payPeriod: string | undefined } | undefined,
): { periodsPerYear: number; incomplete: boolean } {
  if (!job || job.payPeriod == null)
    return { periodsPerYear: 0, incomplete: method === "fixed_per_period" };
  return {
    periodsPerYear: getPeriodsPerYear(job.payPeriod),
    incomplete: false,
  };
}

/** Minimal fields needed from the DB contribution_accounts row. */
export type ContributionRow = {
  id: number;
  personId: number | null;
  jobId: number | null;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string;
  contributionMethod: string;
  contributionValue: string | number;
  taxTreatment: string;
  employerMatchType: string | null;
  employerMatchValue: string | null;
  employerMatchRate?: string | number | null;
  employerMaxMatchPct: string | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
  /** Set by the IRS-limit cap pass; calculations read computeValue(c). */
  cappedValue?: number;
};

export type JobRef = {
  id: number;
  personId: number;
  payPeriod: string | undefined;
};

/** A job's contributionPay (lib/pure/household/compensation.ts): base salary and the bonus. */
export type JobSalaryRef = {
  job: { id: number; personId: number };
  salary: number;
  bonusGross?: number;
  /** This year's bonus (the pinned one when set) — this year's lines only. */
  bonusGrossThisYear?: number;
};

/**
 * The job whose pay a contribution is figured on: its own job, or — for an
 * account not tied to one — the person's job. One lookup for the summary,
 * the display specs and the engine specs.
 */
export function jobPayFor<T extends { job: { id: number; personId: number } }>(
  c: { jobId: number | null; personId: number | null },
  jobSalaries: readonly T[],
): T | undefined {
  return c.jobId
    ? jobSalaries.find((x) => x.job.id === c.jobId)
    : jobSalaries.find((x) => x.job.personId === c.personId);
}

/**
 * A contribution's yearly amount, the paycheck's way: regular paychecks plus the bonus check's
 * share (bonusCheckContribution). Used by the summary and the projection; this year passes the
 * pinned bonus as `bonusGross`, the projection the formula bonus.
 */
export function annualContributionWithBonus(
  c: {
    contributionMethod: string | null;
    contributionValue: string | number | null;
    jobId: number | null;
    isPayrollDeducted?: boolean | null;
    fromBonus: boolean | undefined;
    cappedValue?: number;
  },
  pay: { salary: number; bonusGross?: number },
  periodsPerYear: number,
): number {
  const method = c.contributionMethod ?? "percent_of_salary";
  const value = computeValue(c);
  const regular = computeAnnualContribution(
    method,
    value,
    pay.salary,
    periodsPerYear,
  );
  return (
    regular +
    bonusCheckContribution(
      {
        isPayrollDeducted: isPaidThroughPayroll(c),
        fromBonus: c.fromBonus,
        rateOfGross:
          method === "percent_of_salary" ? fractionFromPercent(value) : null,
        perPeriodContribution:
          method === "fixed_per_period"
            ? value
            : // Never divide by an unresolved (0) pay-period count.
              safeDivide(regular, periodsPerYear, 0),
      },
      pay.bonusGross ?? 0,
    )
  );
}

/**
 * Each row's yearly employee money (computeValue), the pay its match uses, and rows with an
 * unresolvable pay period (money 0); shared by the category aggregate and the cap pass.
 */
export function contributionRowAmounts(
  activeContributions: readonly ContributionRow[],
  activeJobs: readonly JobRef[],
  jobSalaries: readonly JobSalaryRef[],
): {
  annualById: Map<number, number>;
  salaryById: Map<number, number>;
  incompleteAccountIds: number[];
} {
  const incompleteAccountIds: number[] = [];
  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  const bonusGroups = matchPayGroupsWithBonus([...activeContributions]);
  for (const c of activeContributions) {
    // Direct job link, or fall back to person's first active job when jobId is null
    const js = jobPayFor(c, jobSalaries);
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContributionPeriods(
      c.contributionMethod,
      job,
    );
    if (incomplete) incompleteAccountIds.push(c.id);
    const annual = incomplete
      ? 0
      : annualContributionWithBonus(
          c,
          { salary, bonusGross: js?.bonusGross },
          periods,
        );
    // Match on the pay the deferrals came from, bonus checks included.
    salaryById.set(
      c.id,
      salary + (bonusGroups.has(matchGroupKey(c)) ? (js?.bonusGross ?? 0) : 0),
    );
    annualById.set(c.id, annual);
  }
  return { annualById, salaryById, incompleteAccountIds };
}
