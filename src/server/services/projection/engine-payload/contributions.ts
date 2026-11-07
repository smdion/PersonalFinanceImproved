/** The engine payload's contributions, capped at this year's limits. */
import {
  getAccountTypeConfig,
  type AccountCategory,
} from "@/lib/config/account-types";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import { accountGroupLimits } from "@/lib/pure/contributions/contribution-caps";
import {
  capEffectiveContribs,
  type CapPassHousehold,
} from "@/lib/pure/contributions/cap-pass";
import type { thisYearFilingStatus } from "@/server/services/tax/filing-status";
import type { JobSalaryRef } from "@/lib/pure/contributions/contribution-rows";
import type { fetchRetirementData, applyProfiles } from "./load";
import type { resolveTaxYear } from "./tax-year";

/**
 * This year's active contribution rows, capped at the IRS limits, with
 * each limit group's household limit and the totals by category.
 */
export function capContributions(
  resolvedTax: ReturnType<typeof resolveTaxYear>["resolvedTax"],
  people: Awaited<ReturnType<typeof fetchRetirementData>>["people"],
  birthYearByPersonId: Map<number, number>,
  thisYearFiling: Awaited<ReturnType<typeof thisYearFilingStatus>>,
  currentYear: number,
  allContribs: Awaited<ReturnType<typeof applyProfiles>>["allContribs"],
  activeJobs: Awaited<ReturnType<typeof applyProfiles>>["patchedJobs"],
  jobSalaries: (JobSalaryRef & { totalComp: number })[],
) {
  // IRS limits: the `contribution_limits` rows for the resolved tax year
  // (resolveTaxParams already filtered and coerced them to numbers).
  const limitsMap: Record<string, number> = resolvedTax.limits;

  // The IRS-limit cap pass runs on every set of effective rows (these and
  // each profile switch's), so every figure reads the capped value.
  const irsLimitPeople = people.map((p) => ({
    id: p.id,
    birthYear: birthYearByPersonId.get(p.id) ?? null,
  }));
  // This year's caps follow this year's return (the household setting),
  // as the paycheck's do; the projection's brackets keep the profile's.
  const capFilingStatus = thisYearFiling.status ?? "";
  const capHousehold: CapPassHousehold = {
    people: irsLimitPeople,
    limits: limitsMap,
    filingStatus: capFilingStatus,
    taxYear: currentYear,
  };
  // A jobless row is active when its person is known, or when it has no
  // person: a joint account (settings/contribution-accounts.ts), which
  // would otherwise drop out of every total.
  const activeContribs = capEffectiveContribs(
    allContribs
      .filter(
        (c) =>
          activeJobs.some((j) => j.id === c.jobId) ||
          (c.jobId === null &&
            (c.personId === null || people.some((p) => p.id === c.personId))),
      )
      .map((c) => ({ ...c, accountType: c.accountType as AccountCategory })),
    { ...capHousehold, activeJobs, jobSalaries },
  );
  // Who holds which limited account, and each limit group's household
  // limit (every shared limit counted once): what the pages show, and what
  // the engine sizes limits from without specs.
  const irsLimitAccounts = activeContribs
    .filter((c) => getAccountTypeConfig(c.accountType).hasIrsLimit)
    .map((c) => ({
      personId: c.personId,
      accountType: c.accountType,
      hsaCoverageType: c.hsaCoverageType ?? null,
    }));
  const irsGroupLimits = Object.fromEntries(
    accountGroupLimits(irsLimitAccounts, {
      taxYear: currentYear,
      filingStatus: capFilingStatus,
      limits: limitsMap,
      people: irsLimitPeople.map((p) => ({ ...p, wages: null })),
    }),
  );
  // Aggregate contributions and employer match by category (shared helper — single pass)
  const {
    contribByCategory,
    employerMatchByCategory,
    retirementOnly: retirementContrib,
  } = aggregateContributionsByCategory(activeContribs, activeJobs, jobSalaries);

  return {
    limitsMap,
    irsLimitPeople,
    capHousehold,
    activeContribs,
    irsLimitAccounts,
    irsGroupLimits,
    contribByCategory,
    employerMatchByCategory,
    retirementContrib,
  };
}
