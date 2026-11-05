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
} from "@/lib/pure/paycheck/paycheck";
import { matchPayGroupsWithBonus, matchGroupKey } from "./employer-match";

/**
 * Fallback periods-per-year for a jobless contribution account: the active
 * jobs' pay period, or `incomplete: true` if there's none, or if they're on
 * different schedules ("per paycheck" then has no single answer: 26 checks
 * or 24 — attach a job or use a monthly amount). `periodsPerYear` is a
 * placeholder when incomplete; callers must not use it for a
 * `fixed_per_period` account without also honoring `incomplete`. Shared by
 * computeActiveSummary's forward computation and
 * applyContributionAccountEdit's inverse so the two can't drift apart.
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
 * Resolve the periods-per-year for a single contribution row, and whether
 * that resolution is incomplete. The job's real pay-period count is returned
 * for every method (a bonus check's share of a fixed-monthly / fixed-annual
 * account is one paycheck's worth — annualContributionWithBonus), but only
 * `fixed_per_period` consumes it for its yearly amount (see
 * computeAnnualContribution), so only that method can be incomplete: a
 * missing/unresolvable job never marks a `percent_of_salary` or
 * `fixed_monthly` account incomplete (see the plan's method-gated
 * treatment) — it just resolves `0`, which callers must not divide by.
 * `job` is the row's own resolved job (by jobId, or by personId for a
 * jobless account) — `undefined` means no job could be resolved for this
 * row at all.
 */
export function resolveContribPeriods(
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
export type ContribRow = {
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

/** A job's contributionPay (server/helpers/salary.ts): base salary and the bonus. */
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
 * A contribution's yearly amount, the paycheck's way: what the regular
 * paychecks take from the base salary, plus what the bonus check takes
 * (bonusCheckContribution — percent-of-pay at its rate of the bonus, a fixed
 * amount once more; only for payroll accounts set to be taken from bonus
 * checks). The one
 * yearly amount the contribution summary and the retirement projection
 * use. (The budget follows regular paychecks only — base salary.) This
 * year's figures pass the pinned bonus as `bonusGross`; the projection
 * passes the formula bonus (contributionPay).
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
 * Each contribution row's yearly employee money (from computeValue — the
 * capped value when set), the pay its match is figured on, and the rows
 * whose pay period can't be resolved (yearly money 0). One computation for
 * the category aggregate and the cap pass.
 */
export function contribRowAmounts(
  activeContribs: readonly ContribRow[],
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
  const bonusGroups = matchPayGroupsWithBonus([...activeContribs]);
  for (const c of activeContribs) {
    // Direct job link, or fall back to person's first active job when jobId is null
    const js = jobPayFor(c, jobSalaries);
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
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
