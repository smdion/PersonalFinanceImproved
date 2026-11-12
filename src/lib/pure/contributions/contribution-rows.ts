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
import {
  bonusCheckContribution,
  isPaidThroughPayroll,
} from "@/lib/pure/paycheck/bonus";

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
  ownership: AccountOwnership;
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
