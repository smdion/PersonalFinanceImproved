/** A contribution row's money over the checks a job pays in the tax year (the cap pass's input). */
import type { CapPerson } from "./contribution-caps.types";
import {
  type ContributionRow,
  type JobRef,
  type JobSalaryRef,
  jobPayFor,
} from "./contribution-rows";
import { contributionRowAmounts } from "./row-amounts";

/** A job's pay for the cap pass: base salary and bonus, `totalComp` (the W-2 pay before pre-tax
 *  money that bounds an IRA), the `share` of a year's regular checks it pays (absent = all) and
 *  whether it `ended` before the date (its rows' money is already in). */
export type CapJobPay = JobSalaryRef & {
  totalComp?: number;
  share?: number;
  ended?: true;
};

/** A person as the cap pass reads them: its wages come from the jobs' pay. */
export type CapPassPerson = Omit<CapPerson, "wages">;

/**
 * contributionRowAmounts over each job's `share` of a year's regular checks: a row's regular-check
 * money and the pay its match uses are that share of a year's; bonus-check money is as given (the
 * caller leaves out a bonus the job doesn't pay). A row with no job takes no share.
 */
export function rowAmountsOverChecks(
  rows: readonly ContributionRow[],
  activeJobs: readonly JobRef[],
  jobSalaries: readonly CapJobPay[],
) {
  const full = contributionRowAmounts(rows, activeJobs, jobSalaries);
  if (jobSalaries.every((js) => (js.share ?? 1) === 1)) return full;
  const regular = contributionRowAmounts(
    rows,
    activeJobs,
    jobSalaries.map((js) => ({ ...js, bonusGross: 0 })),
  );
  const unpaid = (c: ContributionRow) =>
    c.jobId === null ? 0 : 1 - (jobPayFor(c, jobSalaries)?.share ?? 1);
  const overChecks = (all: Map<number, number>, reg: Map<number, number>) =>
    new Map(
      rows.map((c) => [c.id, all.get(c.id)! - reg.get(c.id)! * unpaid(c)]),
    );
  return {
    ...full,
    annualById: overChecks(full.annualById, regular.annualById),
    salaryById: overChecks(full.salaryById, regular.salaryById),
  };
}
