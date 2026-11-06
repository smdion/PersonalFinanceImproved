/** The parts of a projection response that need no engine run: what the
 *  Retirement, tax and brokerage pages read beside the result. */
import { portfolioTaxTypeOf } from "@/lib/config/tax-treatment-buckets";
import {
  strategyParamFields,
  type StrategyParamColumn,
} from "@/lib/config/withdrawal-strategies";
import { buildContributionDisplaySpecs } from "@/lib/pure/contributions/display-specs";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import type { prepareProjectionRun } from "@/server/services/projection/projection-run";

/** A built payload (not null), notConfigured or ready. */
type Payload = NonNullable<
  Awaited<ReturnType<typeof prepareProjectionRun>>["payload"]
>;

/** A settings row's strategy param columns, as stored. */
function pickStrategyParamColumns<
  T extends Partial<Record<StrategyParamColumn, unknown>>,
>(row: T): Pick<T, StrategyParamColumn> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the keys are exactly the param columns
  return Object.fromEntries(
    strategyParamFields().map((f) => [f.column, row[f.column]]),
  ) as Pick<T, StrategyParamColumn>;
}

/** Per-account contribution specs used for projection, each with its
 *  parent category and account display name. */
export function projectionContributionSpecs(
  payload: Payload,
  nameMap: Map<number, string>,
) {
  const {
    activeContribs,
    people,
    activeJobs,
    jobSalaries,
    perfCategoryMap,
    perfAccountMap,
    accountBreakdownByCategory,
  } = payload;
  return buildContributionDisplaySpecs(
    activeContribs,
    people,
    activeJobs,
    jobSalaries,
  ).map(({ id, personId, ...rest }) => {
    // Add parentCategory from the linked performance account.
    // Looked up by the source row's stable id — personId/ownerName
    // can't disambiguate between multiple joint contributions in the
    // same category, since both are null for every joint row.
    const contrib = activeContribs.find((c) => c.id === id);
    const parentCategory =
      contrib?.parentCategory ??
      (contrib?.performanceAccountId
        ? perfCategoryMap.get(contrib.performanceAccountId)
        : undefined);
    // Match to portfolio account display name using same cascade as engine
    const matchTaxType =
      portfolioTaxTypeOf(rest.taxTreatment) ?? rest.taxTreatment;
    const catAccts = accountBreakdownByCategory[rest.category] ?? [];
    const exactOwner = (a: { ownerPersonId?: number; ownerName?: string }) =>
      a.ownerPersonId != null && personId != null
        ? a.ownerPersonId === personId
        : a.ownerName === rest.ownerName;
    const noOwner = (a: { ownerPersonId?: number; ownerName?: string }) =>
      a.ownerPersonId === undefined && a.ownerName === undefined;
    const parentCatMatch = (a: { parentCategory?: string }) => {
      if (a.parentCategory && parentCategory)
        return a.parentCategory === parentCategory;
      return true;
    };
    const matchedAcct =
      catAccts.find(
        (a) => exactOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
      ) ??
      catAccts.find(
        (a) => noOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
      ) ??
      catAccts.find((a) => exactOwner(a) && parentCatMatch(a)) ??
      catAccts.find((a) => (exactOwner(a) || noOwner(a)) && parentCatMatch(a));
    // Fallback: use linked performance account's display name,
    // routed through the shared precedence rule (portfolio-labels.ts)
    // so THIS contribution row's own real owner (personId) wins over
    // perfAcct's own ownershipType — a shared, jointly-tracked master
    // (e.g. one Vanguard IRA both spouses contribute to separately)
    // has ownershipType "joint", which would otherwise render "Joint
    // ..." for every such row instead of each person's own name.
    const perfAcct = contrib?.performanceAccountId
      ? perfAccountMap.get(contrib.performanceAccountId)
      : undefined;
    const perfFallback = perfAcct
      ? portfolioAccountLabel(perfAcct, perfAcct, personId, nameMap)
      : undefined;
    return {
      ...rest,
      personId,
      parentCategory,
      // Prefer perf account name, fall back to portfolio match name
      accountDisplayName: perfFallback ?? matchedAcct?.name,
    };
  });
}

/** The plan's settings as the assumptions band reads and writes them. */
export function projectionSettings(payload: Payload) {
  const {
    settings,
    planRetirementAge,
    planEndAge,
    baseEngineInput,
    filingStatus,
    distributionTaxRates,
  } = payload;
  return {
    // The plan's ages, on the same scale as each row's age. Not anyone's
    // setting: a save sends back ownRetirementAge / ownEndAge.
    retirementAge: planRetirementAge,
    endAge: planEndAge,
    retirementYear: baseEngineInput.retirementYear,
    ownRetirementAge: settings.retirementAge,
    ownEndAge: settings.endAge,
    annualInflation: settings.annualInflation,
    postRetirementInflation: settings.postRetirementInflation,
    salaryAnnualIncrease: settings.salaryAnnualIncrease,
    // From app_settings["brokerage_contribution_increase"], resolved
    // into the engine payload — surfaced so the assumptions report can
    // state it (it compounds into projected brokerage balance). Read
    // from the server-resolved payload, never recomputed client-side.
    brokerageContributionIncrease:
      baseEngineInput.brokerageContributionRamp ?? 0,
    personId: settings.personId,
    // Retirement Profiles phase 4 (the assumptions band) — client
    // writes must scope back to the profile these values came from,
    // not the household's globally-active one. See
    // buildSettingsPatch/retirementSettings.upsert's docblocks.
    profileId: settings.profileId,
    returnAfterRetirement: settings.returnAfterRetirement,
    salaryCap: settings.salaryCap,
    withdrawalRate: settings.withdrawalRate,
    taxMultiplier: settings.taxMultiplier,
    grossUpForTaxes: settings.grossUpForTaxes,
    rothBracketTarget: settings.rothBracketTarget,
    enableRothConversions: settings.enableRothConversions,
    rothConversionTarget: settings.rothConversionTarget,
    withdrawalStrategy: settings.withdrawalStrategy,
    discretionaryWithdrawalOrder: settings.discretionaryWithdrawalOrder,
    withdrawalRoutingMode: settings.withdrawalRoutingMode,
    withdrawalOrder: settings.withdrawalOrder,
    withdrawalSplits: settings.withdrawalSplits,
    ...pickStrategyParamColumns(settings),
    rmdExcessHandling: settings.rmdExcessHandling,
    rmdExcessTargetPerformanceAccountId:
      settings.rmdExcessTargetPerformanceAccountId,
    qcdMaximize: settings.qcdMaximize,
    rmdSmoothingEnabled: settings.rmdSmoothingEnabled,
    rmdSmoothingMaxBracketTarget: settings.rmdSmoothingMaxBracketTarget,
    socialSecurityMonthly: settings.socialSecurityMonthly,
    ssStartAge: settings.ssStartAge,
    enableIrmaaAwareness: settings.enableIrmaaAwareness,
    irmaaOnTopOfBudget: settings.irmaaOnTopOfBudget,
    gapYearStopSaving: settings.gapYearStopSaving,
    gapYearDraws: settings.gapYearDraws,
    enableAcaAwareness: settings.enableAcaAwareness,
    householdSize: settings.householdSize,
    filingStatus,
    filingStatusExplicit: settings.filingStatus ?? null,
    standardDeduction: distributionTaxRates.standardDeduction ?? null,
  };
}
