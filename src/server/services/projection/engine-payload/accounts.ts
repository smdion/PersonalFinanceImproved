/** The engine payload's starting accounts. */
import type * as schema from "@/lib/db/schema";
import { retirementProfileIsFallback } from "@/lib/pure/household/retirement-profile";
import { readProfileFilingStatus } from "@/lib/pure/tax/filing-status";
import { resolveRmdExcessTarget } from "@/lib/pure/retirement/rmd-excess-target";
import {
  findMissingCostBasis,
  missingCostBasisWarning,
} from "@/lib/pure/accounts/basis-consistency";
import {
  computeTaxBucketBreakdown,
  unlinkedRowsWarning,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { rebookedRowsWarning } from "@/lib/pure/accounts/tax-buckets/rebooked-rows";
import {
  unknownTypeContributionNote,
  unknownTypeNote,
  unknownTypeRows,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";
import { contributionAccountName } from "@/server/services/contributions/account-name";
import { buildIndividualAccounts } from "./individual-accounts";
import type { RetirementData } from "./load";
import type { perPersonSettingsFor } from "./settings-for";

/** Brokerages holding money with no cost basis: the projection taxes every
 *  dollar drawn from them as a gain — say so (0 also means "not entered"). */
function missingBasisWarnings(
  accountBreakdownByCategory: ReturnType<
    typeof computeTaxBucketBreakdown
  >["accountBreakdownByCategory"],
): string[] {
  return [
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
}

/**
 * The starting portfolio: balances by tax bucket and by account, where
 * reinvested RMD money goes, the input warnings, and each account the
 * engine draws from with its owner's dates.
 */
export function startingAccounts(
  data: RetirementData,
  profile: {
    settings: typeof schema.retirementSettings.$inferSelect;
    activeProfileId: number | null;
    opts: { retirementProfileId?: number };
    perPersonSettings: ReturnType<
      typeof perPersonSettingsFor
    >["perPersonSettings"];
    asOfDate: Date;
  },
) {
  const {
    snapshotData,
    people,
    perfAccounts,
    allAppSettings,
    retProfiles,
    allJobs,
    jobLinkRows,
    accountBasisRows,
  } = data;
  const { settings, activeProfileId, opts, perPersonSettings, asOfDate } =
    profile;
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
  const basisWarnings = missingBasisWarnings(accountBreakdownByCategory);
  const viewingFallbackProfile =
    activeProfileId !== opts.retirementProfileId &&
    retirementProfileIsFallback(allAppSettings, retProfiles);
  const inputWarnings = [
    ...readProfileFilingStatus(settings.filingStatus).notes,
    ...(viewingFallbackProfile
      ? [
          `No active retirement profile is set, so this uses ${retProfiles.find((p) => p.id === activeProfileId)?.name}. Choose one in the Retirement profiles.`,
        ]
      : []),
    ...(rmdTarget.warning ? [rmdTarget.warning] : []),
    ...basisWarnings,
  ];
  // Notes that describe the household's accounts, and where each sits in the
  // list (Simple mode, which has no accounts, leaves them out).
  const accountNoteAt: number[] = [];
  const addAccountNotes = (notes: readonly string[]) => {
    for (const note of notes) accountNoteAt.push(inputWarnings.push(note) - 1);
  };
  addAccountNotes(unlinkedRowsWarning(accountBreakdownByCategory));
  inputWarnings.push(
    ...(snapshotData ? rebookedRowsWarning(snapshotData.accounts, people) : []),
    ...unknownTypeRows(snapshotData?.accounts ?? [], people).map(
      unknownTypeNote,
    ),
  );
  const personNameById = new Map(people.map((p) => [p.id, p.name]));
  const performanceAccountsById = new Map(perfAccounts.map((p) => [p.id, p]));
  for (const account of data.unknownTypeContributions)
    inputWarnings.push(
      unknownTypeContributionNote(
        contributionAccountName(
          account,
          { performanceAccountsById, jobs: allJobs },
          personNameById,
        ),
        account.accountType,
      ),
    );

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
    accountNoteAt,
    addAccountNotes,
    personNameById,
    birthYearByPersonId,
    individualAccounts,
  };
}
