/** A contribution row in yearly dollars, and the job its pay comes from. */
import type {
  ContributionMethod,
  EmployerMatchType,
} from "@/lib/config/enum-values";
import { safeDivide } from "@/lib/utils/math";
import type { AccountCategory } from "@/lib/config/account-types";
import type { AccountOwnership } from "@/lib/config/enum-values";
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

/** A joint row the household pays; a joint row tied to a job sits in that job's rows. */
function isHouseholdJointRow(row: {
  ownership?: AccountOwnership | null;
  jobId: number | null;
}): boolean {
  return row.ownership === "joint" && row.jobId === null;
}

/** A row's job and the pay schedule its per-check amount runs on: its own job's; with no job, its
 *  person's, or for a household joint row (no job) the one schedule every active job pays on. With
 *  none, a per-check row is `incomplete` ($0, flagged); `periodsPerYear` 0 is never divided by. */
export function rowPaySchedule<J extends JobRef>(
  row: {
    contributionMethod?: string | null;
    jobId: number | null;
    personId: number | null;
    ownership?: AccountOwnership | null;
  },
  activeJobs: readonly J[],
): { periodsPerYear: number; incomplete: boolean; job: J | undefined } {
  const joint = isHouseholdJointRow(row);
  const jobs =
    row.jobId !== null
      ? activeJobs.filter((j) => j.id === row.jobId)
      : joint
        ? activeJobs
        : activeJobs.filter((j) => j.personId === row.personId).slice(0, 1);
  const schedules = new Set(jobs.flatMap((j) => j.payPeriod ?? []));
  const [only] = schedules;
  const job = joint ? undefined : jobs[0];
  return only !== undefined && schedules.size === 1
    ? { periodsPerYear: getPeriodsPerYear(only), incomplete: false, job }
    : {
        periodsPerYear: 0,
        incomplete: row.contributionMethod === "fixed_per_period",
        job,
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
  contributionMethod: ContributionMethod;
  contributionValue: string | number;
  taxTreatment: string;
  employerMatchType: EmployerMatchType | null;
  employerMatchValue: string | null;
  employerMatchRate?: string | number | null;
  employerMaxMatchPct: string | null;
  /** Paid through payroll; null/absent = when it has a job. */
  isPayrollDeducted?: boolean | null;
  /** Also taken from bonus checks (Contribution Profile election). */
  fromBonus: boolean | undefined;
  /** Set by the IRS-limit cap pass; calculations read computeValue(c). */
  cappedValue?: number;
  ownership?: AccountOwnership | null;
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

/** The job pay a contribution is figured on: its own job's, else its person's (as rowPaySchedule). */
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
    contributionMethod: ContributionMethod | null;
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
    const js = jobPayFor(c, jobSalaries);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = rowPaySchedule(
      c,
      activeJobs,
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
