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
  resolveContribPeriods,
  annualContributionWithBonus,
  type ContribRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution-rows";

type PersonRef = { id: number; name: string };

/** Output of buildContributionDisplaySpecs — per-record spec with match. */
type ContribDisplaySpec = {
  /** Source contribution_accounts.id — the only reliable way to look this
   *  spec's row back up when personId/ownerName can't disambiguate (e.g.
   *  multiple joint contributions in the same category, where both are
   *  personId: null and ownerName: null). */
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
 * Build per-record contribution display specs from DB rows.
 * Each record gets its own matchAnnual computed individually.
 * Then, within each (person, category) group, total match is redistributed
 * proportionally by contribution amount. This ensures Roth+Traditional 401k
 * for the same person each show their fair share of the employer match.
 *
 * This is the single source of truth for "how do we display per-spec match?"
 * Used by the retirement engine card and available to any other consumer.
 */
export function buildContributionDisplaySpecs(
  activeContribs: (ContribRow & CapPassed)[],
  people: PersonRef[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): ContribDisplaySpec[] {
  const filtered = activeContribs.filter(
    (c) => Number(c.contributionValue) > 0,
  );

  const salaryById = new Map<number, number>();
  const annualById = new Map<number, number>();
  const incompleteById = new Map<number, boolean>();
  const bonusGroups = matchPayGroupsWithBonus(filtered);
  for (const c of filtered) {
    const job = c.jobId
      ? activeJobs.find((j) => j.id === c.jobId)
      : activeJobs.find((j) => j.personId === c.personId);
    const js = jobPayFor(c, jobSalaries);
    const salary = js?.salary ?? 0;
    const { periodsPerYear: periods, incomplete } = resolveContribPeriods(
      c.contributionMethod,
      job,
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
