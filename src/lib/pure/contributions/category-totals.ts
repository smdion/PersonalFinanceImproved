/** Contributions and employer match totaled by waterfall category. */

import { safeDivide } from "@/lib/utils/math";
import {
  type AccountCategory,
  buildCategoryRecord,
  isRetirementMoney,
  isTaxFree,
  categoriesWithTaxPreference,
} from "@/lib/config/account-types";
import type { CapPassed } from "./contribution-caps";
import { toNumber } from "@/lib/utils/numbers";
import { computeGroupedEmployerMatch, storedMatchRate } from "./employer-match";
import {
  contributionRowAmounts,
  type ContributionRow,
  type JobRef,
  type JobSalaryRef,
} from "./contribution-rows";

/** Per-category contribution totals with tax breakdown. */
type ContributionCategorySummary = {
  annual: number;
  rothFraction: number;
  rothAnnual: number;
  tradAnnual: number;
};

/**
 * Aggregate contributions and employer match by waterfall category in a single pass.
 * Replaces the duplicate loops in the retirement router that separately compute
 * `employerMatchByCategory` and `contribByCategory`.
 *
 * Returns both the per-category employee contribution summary and the per-category
 * employer match totals. Used by the retirement engine and available to any consumer.
 */
export function aggregateContributionsByCategory(
  activeContributions: (ContributionRow & CapPassed)[],
  activeJobs: JobRef[],
  jobSalaries: JobSalaryRef[],
): {
  contribByCategory: Record<AccountCategory, ContributionCategorySummary>;
  employerMatchByCategory: Record<AccountCategory, number>;
  /** Employer money per contribution row id. */
  employerMatchById: Map<number, number>;
  /** Employer match broken down by category → parentCategory → amount. */
  employerMatchByParentCat: Map<AccountCategory, Map<string, number>>;
  /** The same totals over retirement money only (`isRetirementMoney`):
   *  what Simple tax mode simulates. */
  retirementOnly: {
    contribByCategory: Record<AccountCategory, ContributionCategorySummary>;
    employerMatchByCategory: Record<AccountCategory, number>;
  };
  /** Ids of `fixed_per_period` accounts with no resolvable job/pay period —
   *  excluded from the totals above (annual treated as 0) rather than
   *  defaulted to a guessed pay period. See resolveContribPeriods. */
  incompleteAccountIds: number[];
} {
  const emptySummaries = () =>
    buildCategoryRecord((): ContributionCategorySummary => ({
      annual: 0,
      rothFraction: 0,
      rothAnnual: 0,
      tradAnnual: 0,
    }));
  const contribByCategory = emptySummaries();
  const retirementContributionByCategory = emptySummaries();
  const employerMatchByCategory = buildCategoryRecord(() => 0);
  const retirementMatchByCategory = buildCategoryRecord(() => 0);
  const employerMatchByParentCat = new Map<
    AccountCategory,
    Map<string, number>
  >();

  const { annualById, salaryById, incompleteAccountIds } =
    contributionRowAmounts(activeContributions, activeJobs, jobSalaries);
  for (const c of activeContributions) {
    const annual = annualById.get(c.id)!;
    for (const summaries of isRetirementMoney(c.parentCategory)
      ? [contribByCategory, retirementContributionByCategory]
      : [contribByCategory]) {
      summaries[c.accountType].annual += annual;
      if (isTaxFree(c.taxTreatment)) {
        summaries[c.accountType].rothAnnual += annual;
      } else {
        summaries[c.accountType].tradAnnual += annual;
      }
    }
  }

  const matchByRow = computeGroupedEmployerMatch(
    activeContributions.map((c) => ({
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
      employerMatchTaxTreatment: "pre_tax", // not used by this aggregation
    })),
  );

  for (const c of activeContributions) {
    const cat = c.accountType;
    const matchAmount = matchByRow.get(c.id)!.matchAnnual;
    employerMatchByCategory[cat] += matchAmount;
    if (isRetirementMoney(c.parentCategory))
      retirementMatchByCategory[cat] += matchAmount;

    // Track match by parentCategory for correct per-account distribution
    if (matchAmount > 0 && c.parentCategory) {
      if (!employerMatchByParentCat.has(cat))
        employerMatchByParentCat.set(cat, new Map());
      const catMap = employerMatchByParentCat.get(cat)!;
      catMap.set(
        c.parentCategory,
        (catMap.get(c.parentCategory) ?? 0) + matchAmount,
      );
    }
  }

  // Compute Roth fractions from actual account data
  for (const summaries of [contribByCategory, retirementContributionByCategory])
    for (const cat of categoriesWithTaxPreference()) {
      const total = summaries[cat].rothAnnual + summaries[cat].tradAnnual;
      summaries[cat].rothFraction = safeDivide(
        summaries[cat].rothAnnual,
        total,
        1,
      );
    }

  return {
    contribByCategory,
    employerMatchByCategory,
    employerMatchById: new Map(
      [...matchByRow].map(([id, m]) => [id, m.matchAnnual]),
    ),
    employerMatchByParentCat,
    retirementOnly: {
      contribByCategory: retirementContributionByCategory,
      employerMatchByCategory: retirementMatchByCategory,
    },
    incompleteAccountIds,
  };
}
