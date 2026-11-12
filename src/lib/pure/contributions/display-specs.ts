/** Per-record contribution display specs, each with its employer match. */

import { roundToCents } from "@/lib/utils/math";
import type { AccountCategory } from "@/lib/config/account-types";
import { type CapPassed, computeValue } from "./contribution-caps";
import { fractionFromPercent } from "./contribution-amount";
import { toNumber } from "@/lib/utils/numbers";
import {
  matchPayGroupsWithBonus,
  matchGroupKey,
  computeGroupedEmployerMatch,
  storedMatchRate,
} from "./employer-match";
import {
  jobPayFor,
  annualContributionWithBonus,
  type ContributionRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution-rows";
import { rowPaySchedule } from "./row-pay";

type PersonRef = { id: number; name: string };

/** Output of buildContributionDisplaySpecs — per-record spec with match. */
type ContributionDisplaySpec = {
  /** Source contribution_accounts.id: the only way back to the row when personId and
   *  ownerName can't tell (several joint rows in a category). */
  id: number;
  category: AccountCategory;
  name: string;
  method: string;
  value: number;
  baseAnnual: number;
  taxTreatment: string;
  ownerName: string | null;
  personId: number | null;
  matchAnnual: number;
  /** True for a `fixed_per_period` account with no resolvable job/pay
   *  period — baseAnnual is 0 (excluded), not a guessed pay period. */
  incomplete: boolean;
};

/**
 * Per-record contribution display specs; each (person, category) group's match is shared out
 * by contribution amount, so Roth and Traditional 401k rows each show their part.
 */
export function buildContributionDisplaySpecs(
  activeContributions: (ContributionRow & CapPassed)[],
  people: PersonRef[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): ContributionDisplaySpec[] {
  const filtered = activeContributions.filter(
    (c) => Number(c.contributionValue) > 0,
  );

  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  const incompleteById = new Map<number, boolean>();
  const bonusGroups = matchPayGroupsWithBonus(filtered);
  for (const c of filtered) {
    const js = jobPayFor(c, jobSalaries);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = rowPaySchedule(
      c,
      activeJobs,
    );
    const cv = computeValue(c);
    salaryById.set(
      c.id,
      salary +
        (bonusGroups.has(matchGroupKey(c))
          ? (js?.bonusGrossThisYear ?? js?.bonusGross ?? 0)
          : 0),
    );
    incompleteById.set(c.id, incomplete);
    annualById.set(
      c.id,
      incomplete
        ? 0
        : roundToCents(
            annualContributionWithBonus(
              { ...c, contributionValue: cv },
              // This year's contribution lines: the pinned bonus when set.
              {
                salary,
                bonusGross: js?.bonusGrossThisYear ?? js?.bonusGross,
              },
              periods,
            ),
          ),
    );
  }

  // computeGroupedEmployerMatch already does the correct proportional
  // redistribution within each account's group (see its docblock) — no
  // separate redistribution pass needed here any more.
  const matchByRow = computeGroupedEmployerMatch(
    filtered.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualById.get(c.id)!,
      salary: salaryById.get(c.id)!,
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMatchRate: storedMatchRate(c.employerMatchRate),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: "pre_tax", // not used by ContributionDisplaySpec
    })),
  );

  return filtered.map((c) => {
    const ownerPerson = people.find((p) => p.id === c.personId);
    const cv = computeValue(c);
    const method = c.contributionMethod ?? "percent_of_salary"; // a stored profile entry may omit it
    const value = method === "percent_of_salary" ? fractionFromPercent(cv) : cv;

    return {
      id: c.id,
      category: c.accountType,
      name: c.subType ?? c.accountType,
      method,
      value,
      baseAnnual: annualById.get(c.id)!,
      taxTreatment: c.taxTreatment,
      ownerName: ownerPerson?.name ?? null,
      personId: c.personId,
      matchAnnual: roundToCents(matchByRow.get(c.id)!.matchAnnual),
      incomplete: incompleteById.get(c.id) ?? false,
    };
  });
}
