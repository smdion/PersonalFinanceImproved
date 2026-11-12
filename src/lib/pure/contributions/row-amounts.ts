/** Each contribution row's yearly employee money and the pay its match uses. */
import {
  annualContributionWithBonus,
  jobPayFor,
  type ContributionRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution-rows";
import { isHouseholdJointRow, rowPaySchedule } from "./row-pay";
import { matchPayGroupsWithBonus, matchGroupKey } from "./employer-match";
import { filterActiveJobs, type JobLike } from "@/lib/pure/household/profiles";
import { roundToCents } from "@/lib/utils/math";

/** The fields one row's yearly amount reads. */
type RowAmountInput = Parameters<typeof rowPaySchedule>[0] &
  Parameters<typeof annualContributionWithBonus>[0];

/** One row's yearly employee money, on its pay schedule (rowPaySchedule) and its job's pay
 *  (jobPayFor; `salary` and `bonusGross` as used); an `incomplete` row is $0. The one per-row
 *  amount every path reads. */
export function rowAnnualContribution(
  c: RowAmountInput,
  activeJobs: readonly JobRef[],
  jobSalaries: readonly JobSalaryRef[],
): {
  annual: number;
  incomplete: boolean;
  periodsPerYear: number;
  salary: number;
  bonusGross: number | undefined;
} {
  const pay = jobPayFor(c, jobSalaries);
  const salary = pay?.salary ?? 0;
  const bonusGross = pay?.bonusGross;
  const { periodsPerYear, incomplete } = rowPaySchedule(c, activeJobs);
  const annual = incomplete
    ? 0
    : annualContributionWithBonus(c, { salary, bonusGross }, periodsPerYear);
  return { annual, incomplete, periodsPerYear, salary, bonusGross };
}

/** The household's joint rows (isHouseholdJointRow), each with its yearly money, on the jobs
 *  current on `asOf`. A household joint row has no pay of its own. */
export function jointRowAmounts<
  R extends RowAmountInput & { isActive: boolean },
>(
  rows: readonly R[],
  jobs: readonly (JobRef & Omit<JobLike, "personId">)[],
  asOf: Date,
) {
  const activeJobs = filterActiveJobs(jobs, asOf);
  return rows
    .filter((c) => c.isActive && isHouseholdJointRow(c))
    .map((row) => ({ row, ...rowAnnualContribution(row, activeJobs, []) }));
}

/** The household's joint rows with their monthly money in cents and whether it's incomplete. */
export function jointRows<R extends RowAmountInput & { isActive: boolean }>(
  rows: readonly R[],
  jobs: Parameters<typeof jointRowAmounts>[1],
  asOf: Date,
) {
  return jointRowAmounts(rows, jobs, asOf).map(
    ({ row, annual, incomplete }) => ({
      ...row,
      monthly: roundToCents(annual / 12),
      incomplete,
    }),
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
    const { annual, incomplete, salary, bonusGross } = rowAnnualContribution(
      c,
      activeJobs,
      jobSalaries,
    );
    if (incomplete) incompleteAccountIds.push(c.id);
    // Match on the pay the deferrals came from, bonus checks included.
    salaryById.set(
      c.id,
      salary + (bonusGroups.has(matchGroupKey(c)) ? (bonusGross ?? 0) : 0),
    );
    annualById.set(c.id, annual);
  }
  return { annualById, salaryById, incompleteAccountIds };
}
