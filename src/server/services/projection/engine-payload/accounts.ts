/** The engine payload's starting accounts. */
import type * as schema from "@/lib/db/schema";
import { retirementProfileIsFallback } from "@/lib/pure/household/retirement-profile";
import { resolveRmdExcessTarget } from "@/lib/pure/retirement/rmd-excess-target";
import {
  findMissingCostBasis,
  missingCostBasisWarning,
} from "@/lib/pure/accounts/basis-consistency";
import { computeTaxBucketBreakdown } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { buildIndividualAccounts } from "./individual-accounts";
import type { fetchRetirementData } from "./load";
import type { perPersonSettingsFor } from "./settings-for";

/**
 * The starting portfolio: balances by tax bucket and by account, where
 * reinvested RMD money goes, the input warnings, and each account the
 * engine draws from with its owner's dates.
 */
export function startingAccounts(
  snapshotData: Awaited<ReturnType<typeof fetchRetirementData>>["snapshotData"],
  people: Awaited<ReturnType<typeof fetchRetirementData>>["people"],
  perfAccounts: Awaited<ReturnType<typeof fetchRetirementData>>["perfAccounts"],
  settings: typeof schema.retirementSettings.$inferSelect,
  activeProfileId: number | null,
  opts: { retirementProfileId?: number },
  allAppSettings: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["allAppSettings"],
  retProfiles: Awaited<ReturnType<typeof fetchRetirementData>>["retProfiles"],
  perPersonSettings: ReturnType<
    typeof perPersonSettingsFor
  >["perPersonSettings"],
  allJobs: Awaited<ReturnType<typeof fetchRetirementData>>["allJobs"],
  jobLinkRows: Awaited<ReturnType<typeof fetchRetirementData>>["jobLinkRows"],
  accountBasisRows: Awaited<
    ReturnType<typeof fetchRetirementData>
  >["accountBasisRows"],
  asOfDate: Date,
) {
  // Portfolio by tax bucket + per-account balances (combined for engine).
  // Shared with the Tax Buckets analysis tool — see src/lib/pure/accounts/tax-buckets/tax-buckets.ts.
  const taxBucketBreakdown = computeTaxBucketBreakdown(
    snapshotData,
    people,
    perfAccounts,
  );
  const {
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
  } = taxBucketBreakdown;

  // Where reinvested RMD money goes: the chosen Retirement brokerage, else
  // every one, never a Portfolio account. With none, a projection-only one
  // holds that money and contribution overflow.
  const rmdTarget = resolveRmdExcessTarget({
    targetPerformanceAccountId:
      settings.rmdExcessTargetPerformanceAccountId ?? null,
    reinvest: settings.rmdExcessHandling !== "spend",
    entries: Object.entries(accountBreakdownByCategory).flatMap(
      ([category, accounts]) => accounts.map((a) => ({ ...a, category })),
    ),
    perfAccounts,
  });
  // Brokerages holding money with no cost basis: the projection taxes every
  // dollar drawn from them as a gain — say so (0 also means "not entered").
  const basisWarnings = [
    ...new Set(
      findMissingCostBasis(
        Object.entries(accountBreakdownByCategory).flatMap(
          ([category, accounts]) =>
            accounts
              .filter((a) => a.costBasis != null)
              .map((a) => ({
                category,
                name: a.name,
                balance: a.amount,
                costBasis: a.costBasis!,
              })),
        ),
      ).map((a) => missingCostBasisWarning(a.name)),
    ),
  ];
  const viewingFallbackProfile =
    activeProfileId !== opts.retirementProfileId &&
    retirementProfileIsFallback(allAppSettings, retProfiles);
  const inputWarnings = [
    ...(viewingFallbackProfile
      ? [
          `No active retirement profile is set, so this uses ${retProfiles.find((p) => p.id === activeProfileId)?.name}. Choose one in the Retirement profiles.`,
        ]
      : []),
    ...(rmdTarget.warning ? [rmdTarget.warning] : []),
    ...basisWarnings,
  ];
  const personNameById = new Map(people.map((p) => [p.id, p.name]));

  const birthYearByPersonId = new Map(
    perPersonSettings.map((p) => [p.personId, p.birthYear]),
  );
  // Rule of 55 forecasting override (IndividualAccountInput.
  // ruleOf55ForceIneligible): only ever set true, so a household not using
  // it gets a byte-identical engine input.
  const ruleOf55OverrideByPerson = new Map(
    perPersonSettings.map((p) => [p.personId, p.ruleOf55Override]),
  );
  // When each person's still-active job ends (Rule of 55): their own
  // planned retirement year.
  const retirementYearByPersonId = new Map(
    perPersonSettings.flatMap((ps) => {
      const birthYear = birthYearByPersonId.get(ps.personId);
      return birthYear != null
        ? [[ps.personId, birthYear + ps.retirementAge] as const]
        : [];
    }),
  );
  const individualAccounts = buildIndividualAccounts({
    allJobs,
    jobLinkRows,
    accountBasisRows,
    perfAccounts,
    people,
    asOfDate,
    taxBucketBreakdown,
    birthYearByPersonId,
    retirementYearByPersonId,
    ruleOf55OverrideByPerson,
    rmdTarget,
  });

  return {
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    inputWarnings,
    personNameById,
    birthYearByPersonId,
    individualAccounts,
  };
}
