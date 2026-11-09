/** The parts of a projection response that need no engine run: what the
 *  Retirement, tax and brokerage pages read beside the result. */
import { calendarYear } from "@/lib/utils/date";
import { jobYearsNote } from "@/lib/pure/household/profiles";
import { DEFAULT_RETURN_RATE } from "@/lib/constants";
import { buildAccumulationOrder } from "@/lib/pure/contributions/accumulation-order";
import { computeCurrentStockAllocationPercent } from "@/lib/pure/simulation/stock-share";
import { toNumber } from "@/lib/utils/numbers";
import {
  getAllCategories,
  categoriesWithTaxPreference,
} from "@/lib/config/account-types";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { portfolioTaxTypeOf } from "@/lib/config/tax-treatment-buckets";
import {
  strategyParamFields,
  type StrategyParamColumn,
} from "@/lib/config/withdrawal-strategies";
import { buildContributionDisplaySpecs } from "@/lib/pure/contributions/display-specs";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import type { prepareProjectionRun } from "@/server/services/projection/projection-run";

type Run = Awaited<ReturnType<typeof prepareProjectionRun>>;
/** A built payload (not null), notConfigured or ready. */
type Payload = NonNullable<Run["payload"]>;

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
    const contribution = activeContribs.find((c) => c.id === id);
    const parentCategory =
      contribution?.parentCategory ??
      (contribution?.performanceAccountId
        ? perfCategoryMap.get(contribution.performanceAccountId)
        : undefined);
    // Match to portfolio account display name using same cascade as engine
    const matchTaxType =
      portfolioTaxTypeOf(rest.taxTreatment) ?? rest.taxTreatment;
    const catAccounts = accountBreakdownByCategory[rest.category] ?? [];
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
    const matchedAccount =
      catAccounts.find(
        (a) => exactOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
      ) ??
      catAccounts.find(
        (a) => noOwner(a) && a.taxType === matchTaxType && parentCatMatch(a),
      ) ??
      catAccounts.find((a) => exactOwner(a) && parentCatMatch(a)) ??
      catAccounts.find(
        (a) => (exactOwner(a) || noOwner(a)) && parentCatMatch(a),
      );
    // Fallback: use linked performance account's display name,
    // routed through the shared precedence rule (portfolio-labels.ts)
    // so THIS contribution row's own real owner (personId) wins over
    // perfAccount's own ownershipType — a shared, jointly-tracked master
    // (e.g. one Vanguard IRA both spouses contribute to separately)
    // has ownershipType "joint", which would otherwise render "Joint
    // ..." for every such row instead of each person's own name.
    const perfAccount = contribution?.performanceAccountId
      ? perfAccountMap.get(contribution.performanceAccountId)
      : undefined;
    const perfFallback = perfAccount
      ? portfolioAccountLabel(perfAccount, perfAccount, personId, nameMap)
      : undefined;
    return {
      ...rest,
      personId,
      parentCategory,
      // Prefer perf account name, fall back to portfolio match name
      accountDisplayName: perfFallback ?? matchedAccount?.name,
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
    brokerageContributionIncrease: baseEngineInput.brokerageContributionRamp,
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

/** The return-rate schedule by age, and its rates at and around retirement. */
function returnRateSummary(
  relevantReturnRates: Payload["relevantReturnRates"],
  planRetirementAge: number,
) {
  const schedule = relevantReturnRates.map((r) => {
    const ageMatch = r.label.match(/(\d+)/);
    return { age: ageMatch ? Number(ageMatch[1]) : 0, rate: r.rate };
  });
  const accRates = schedule.filter((r) => r.age <= planRetirementAge);
  return {
    currentRate: schedule[0]?.rate ?? null,
    retirementRate:
      schedule.find((r) => r.age === planRetirementAge)?.rate ?? null,
    postRetirementRate:
      schedule.find((r) => r.age === planRetirementAge + 1)?.rate ?? null,
    avgAccumulation:
      accRates.length > 0
        ? sumBy(accRates, (r) => r.rate) / accRates.length
        : DEFAULT_RETURN_RATE,
    schedule,
  };
}

/** Everything in a projection response but the engine result, from a
 *  built run (ready or notConfigured). */
export function projectionMetadata(data: Run["data"], payload: Payload) {
  const {
    primaryPerson,
    people,
    activeContribs,
    age,
    planRetirementAge,
    totalCompensation,
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    contribByCategory,
    employerMatchByCategory,
    salaryByPerson,
    salaryOverrideRows,
    budgetOverrideRows,
    perPersonSettings,
    budgetProfileSummaries,
    selectedScenario,
    relevantReturnRates,
    displayContribRate,
    annualExpensesVal,
    accumulationExpenses,
    decumulationExpenses,
    accProfile,
    accCol,
    decProfile,
    decCol,
    irsGroupLimits,
    rothConversionPresets,
    baseEngineInput,
  } = payload;
  // Projection health inputs — derived inputs
  // the PlanHealthCard needs for contribution-order and glide-path
  // warnings. Implementation lives in accumulation-order.ts and stock-share.ts.
  const accumulationOrder = buildAccumulationOrder(activeContribs);
  const currentStockAllocationPercent = computeCurrentStockAllocationPercent(
    data,
    age,
  );
  // portfolioAccountLabel wants id → name, for the contributionSpecs
  // perf-account-label fallback below.
  const nameMap = new Map(people.map((p) => [p.id, p.name] as const));

  return {
    /** Job start/end dates the projection counts in whole years. */
    jobYearsNote: jobYearsNote(
      baseEngineInput.workingYearsByPerson ?? {},
      (id) => nameMap.get(id) ?? "",
    ),
    planHealth: {
      currentAge: age,
      accumulationOrder,
      currentStockAllocationPercent,
    },
    combinedSalary: roundToCents(totalCompensation),
    /** Each limit group's household limit, shared limits counted once. */
    irsGroupLimits,
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    /** Per-account contribution specs used for projection (shared helper) */
    contributionSpecs: projectionContributionSpecs(payload, nameMap),
    /** Real-world contribution data derived from active paycheck/contribution accounts */
    realDefaults: {
      contributionRate: displayContribRate,
      taxSplits: Object.fromEntries(
        categoriesWithTaxPreference().map((cat) => [
          cat,
          contribByCategory[cat].rothFraction,
        ]),
      ),
      annualByCategory: Object.fromEntries(
        getAllCategories().map((cat) => [cat, contribByCategory[cat].annual]),
      ),
      employerMatchByCategory,
    },
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      birthYear: calendarYear(p.dateOfBirth),
    })),
    selectedScenario: selectedScenario
      ? {
          distributionTaxRateTraditional:
            selectedScenario.distributionTaxRateTraditional,
          distributionTaxRateRoth: selectedScenario.distributionTaxRateRoth,
          distributionTaxRateBrokerage:
            selectedScenario.distributionTaxRateBrokerage,
        }
      : null,
    returnRateSummary: returnRateSummary(
      relevantReturnRates,
      planRetirementAge,
    ),
    /** DB-stored overrides for salary/budget CRUD in the UI */
    dbSalaryOverrides: salaryOverrideRows.map((o) => ({
      id: o.id,
      personId: o.personId,
      projectionYear: o.projectionYear,
      overrideSalary: toNumber(o.overrideSalary),
      contributionProfileId: o.contributionProfileId ?? null,
      salaryProfileId: o.salaryProfileId ?? null,
      notes: o.notes,
    })),
    salaryByPerson,
    dbBudgetOverrides: budgetOverrideRows
      .filter((o) => o.personId === primaryPerson.id)
      .map((o) => ({
        id: o.id,
        personId: o.personId,
        projectionYear: o.projectionYear,
        overrideMonthlyBudget: toNumber(o.overrideMonthlyBudget),
        notes: o.notes,
      })),
    primaryPersonId: primaryPerson.id,
    settings: projectionSettings(payload),
    perPersonSettings,
    annualExpenses: annualExpensesVal,
    accumulationBudgetProfileId: accProfile?.id ?? null,
    accumulationBudgetColumn: accCol,
    decumulationBudgetProfileId: decProfile?.id ?? null,
    decumulationBudgetColumn: decCol,
    accumulationExpenses,
    decumulationExpenses,
    budgetProfileSummaries,
    /** Unique bracket rates from DB tax brackets for Roth conversion dropdown presets. */
    rothConversionPresets,
    /** Brokerage goals for the brokerage page */
    brokerageGoals: data.brokerageGoalRows.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: toNumber(g.targetAmount),
      targetYear: g.targetYear,
      priority: g.priority,
    })),
  };
}
