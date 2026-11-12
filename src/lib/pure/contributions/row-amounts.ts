/** Each contribution row's yearly employee money and the pay its match uses. */
import {
  annualContributionWithBonus,
  jobPayFor,
  rowPaySchedule,
  type ContributionRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution-rows";
import { matchPayGroupsWithBonus, matchGroupKey } from "./employer-match";

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
