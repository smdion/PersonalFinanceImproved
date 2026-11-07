/** The decumulation year: runDecumulationYear calls its stages in order. */
import { socialSecurityForYear } from "../social-security-income";
import { retirementBrokerageBasisRatio } from "../brokerage-basis";
import type { EngineDecumulationYear } from "../types/projection-result";
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAllCategories,
  nonMedicalPenaltyRate,
} from "../../../config/account-types";
import { countReachingAgeRule } from "@/lib/pure/household/age";
import { cloneAccountBalances } from "../balance-utils";
import { resolveDecumulationConfig } from "../override-resolution";
import { computeWithdrawalEligibility } from "@/lib/pure/accounts/eligibility";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { rmdIncomeByOwner } from "./decumulation-income";
import { enforceYearRmd, qcdStep } from "./rmd-step";
import {
  priceYearTax,
  pricedYearParts,
  repriceConversionYear,
  settleYearDraws,
  yearRothConversion,
} from "./tax-year-settlement";
import { fundingShortfallForYear } from "./funding-shortfall";
import { distributeYearDraws, routeYearDraw } from "./year-draws";
import { yearNeed } from "./year-need";
import { growYearTaxTables } from "./year-tax-tables";
import { decumulationPortfolioContributions } from "./portfolio-contributions";
import { yearCliffChecks } from "./year-cliffs";
import { closeDecumulationYear } from "./year-end";

/** One decumulation year, its stages in today's order; each stage's file
 *  names its decision (UD-04 in rmd-step.ts and tax-year-settlement.ts,
 *  UD-08 in tax-year-settlement.ts). Pushes the row to state.projectionByYear. */
export function runDecumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
  setup: PreYearSetup,
): void {
  const {
    age,
    year,
    returnRate,
    strategyAction,
    retirementBalance,
    totalBalance,
  } = setup;
  const {
    input,
    budgetOverrideMap,
    sortedDecOverrides,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    rmdStartAge,
    rmdStartAgeByPerson,
  } = ctx;
  const {
    balances,
    acctBal,
    priorYearEndTradBalance,
    priorYearEndTradByPerson,
    indBal,
    indBasis,
    brokBasis,
    spendingState,
    incomeHistory,
    depletionTracked,
    accountDepletions,
  } = state;

  const {
    decumulationDefaults,
    filingStatus,
    enableIrmaaAwareness,
    enableAcaAwareness,
    householdSize,
    perPersonBirthYears,
  } = input;

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    sortedDecOverrides,
  );

  // Each account's penalty-free/locked split this year, computed once for
  // both routeForMode sites (the solver's estimate and the real draw), from
  // the running Roth basis the UI shows.
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({ year, indAccts, indBal, indKey, indBasis })
    : undefined;
  // Portfolio-parented money never funds retirement spending: one exclusion
  // a year, read by every step that decides what's available.
  const { nonRetirement } = setup;

  // Reconciliation check: acctBal Roth total should match balances.taxFree
  const acctBalRothTotal = getAllCategories().reduce((s, cat) => {
    const b = acctBal[cat];
    return s + (b.structure === "roth_traditional" ? b.roth : 0);
  }, 0);
  const rothDivergence =
    Math.abs(acctBalRothTotal - balances.taxFree) > 1
      ? `[DIAG] Roth divergence: acctBal.roth=${acctBalRothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - acctBalRothTotal).toFixed(0)}`
      : null;

  // Social Security income reduces withdrawal need (per person from each
  // one's own start age).
  const { ssIncome, ssIncomeByPerson } = socialSecurityForYear(
    input,
    year,
    age,
    ctx.inflation.growth(year - input.asOfDate.getFullYear()),
  );
  const { perOwnerRmd, perPersonRmdTotal, rmdByPerson } = rmdIncomeByOwner(
    year,
    input,
    ctx,
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    priorYearEndTradByPerson,
  );

  const { totalQcd, qcdByPerson } = qcdStep(
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    year,
    indAccts,
    ctx,
    indBal,
    indKey,
    decumulationDefaults,
    config,
    balances,
    acctBal,
  );

  // The brokerage basis ratio of this year's retirement withdrawals: the
  // Retirement brokerages' own (start of year). One ratio for the
  // estimate, the ranking and the real tax.
  const retirementBasisRatio = hasIndividualAccounts
    ? retirementBrokerageBasisRatio(indAccts, indKey, indBal, brokBasis)
    : undefined;

  const taxRates = decumulationDefaults.distributionTaxRates;
  // Retirement money only (PreYearSetup.retirementBalance): Portfolio-
  // parented Traditional money is never withdrawn for spending, so it can't
  // be part of the estimate.
  const retirementPreTax =
    balances.preTax -
    (nonRetirement ? sumBy(Object.values(nonRetirement.trad), (v) => v) : 0);
  const estTraditionalPortion =
    retirementBalance > 0
      ? Math.max(0, retirementPreTax) / retirementBalance
      : 0;

  const {
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    grownIrmaaBracketsForCheck,
    grownIrmaaBracketsForCap,
    fplGrowthFactor,
  } = growYearTaxTables(
    taxRates,
    ctx,
    year,
    perPersonBirthYears,
    age,
    incomeHistory,
  );

  const personsAge65Plus = countReachingAgeRule(
    perPersonBirthYears,
    age,
    "medicare",
    year,
  );
  const { afterTaxNeed, ssSurplus, taxEst, targetWithdrawal } = yearNeed(
    state,
    ssIncome,
    input,
    incomeHistory,
    enableIrmaaAwareness,
    filingStatus,
    personsAge65Plus,
    grownIrmaaBracketsForCheck,
    config,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    balances,
    acctBal,
    totalBalance,
    retirementBasisRatio,
    eligibility,
    nonRetirement,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indBal,
    indBasis,
    year,
  );

  const {
    preWithdrawalAcctBal,
    brokerageBasisRatio,
    resolvedConversionTarget,
    routeResult,
    slots,
    routeWarnings,
    routedUnmetNeed,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
  } = routeYearDraw(
    acctBal,
    balances,
    retirementBasisRatio,
    hasIndividualAccounts,
    indBasis,
    indAccts,
    indKey,
    indBal,
    year,
    taxRates,
    config,
    targetWithdrawal,
    grownTaxBrackets,
    taxEst,
    filingStatus,
    grownLtcgBrackets,
    grownStandardDeduction,
    eligibility,
    nonRetirement,
    rothDivergence,
  );

  const {
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    rmdDivisor,
    ownerRmd,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    rmdAmount,
  } = enforceYearRmd(
    slots,
    perOwnerRmd,
    rmdStartAge,
    age,
    priorYearEndTradBalance,
    rmdByPerson,
    qcdByPerson,
    ctx,
    acctBal,
    indAccts,
    indKey,
    indBal,
    nonRetirement,
    routeWarnings,
    state,
    perPersonRmdTotal,
  );

  const { decIndWithdrawal, basisDraws, rothTaxSplit, earlyWithdrawalPenalty } =
    distributeYearDraws(
      indBal,
      hasIndividualAccounts,
      indAccts,
      indKey,
      brokBasis,
      slots,
      eligibility,
      ownerRmd,
      routeWarnings,
      indBasis,
      year,
    );

  const { priceTax, taxableSS, taxFromSlots } = priceYearTax(
    slots,
    balances,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    grownLtcgBrackets,
    filingStatus,
    totalTraditionalWithdrawal,
    totalRothWithdrawal,
    rothTaxSplit,
    earlyWithdrawalPenalty,
    brokerageBasisRatio,
    taxEst,
    ssIncome,
  );
  const {
    brokerageBasisPortion,
    brokerageGainsPortion,
    actualTaxableIncome,
    penaltyCost,
    ssTaxCost,
    surplusCredit,
    grossUpFactor,
  } = pricedYearParts(
    taxFromSlots,
    slots,
    balances,
    ssSurplus,
    taxEst,
    rmdOverrodeRouting,
    afterTaxNeed,
    state,
  );

  const { rmdExcessAmount } = settleYearDraws(
    slots,
    balances,
    acctBal,
    brokerageBasisPortion,
    indAccts,
    indKey,
    indBal,
    brokBasis,
    config,
    ctx,
    state,
    taxFromSlots,
    surplusCredit,
    rmdOverrodeRouting,
    totalWithdrawal,
    afterTaxNeed,
    hasIndividualAccounts,
    depletionTracked,
    accountDepletions,
    year,
    age,
  );

  const {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  } = yearRothConversion(
    config,
    hasIndividualAccounts,
    rmdStartAgeByPerson,
    indAccts,
    ctx,
    indBal,
    indKey,
    year,
    balances,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    targetWithdrawal,
    brokBasis,
    taxRates,
    grownTaxBrackets,
    grownStandardDeduction,
    resolvedConversionTarget,
    taxableSS,
    taxFromSlots,
    brokerageGainsPortion,
    input,
    enableIrmaaAwareness,
    grownIrmaaBracketsForCap,
    filingStatus,
    acctBal,
    nonRetirement,
  );

  const { taxCost, postConversionLtcgRate, income, niitAmount } =
    repriceConversionYear(
      taxFromSlots,
      actualTaxableIncome,
      rothConversionAmount,
      grownStandardDeduction,
      filingStatus,
      brokerageGainsPortion,
      grownLtcgBrackets,
      priceTax,
      taxableSS,
      taxRates,
      totalTraditionalWithdrawal,
      ssIncome,
    );

  const {
    deliveredAfterTax,
    shortfallMaterialityFloor,
    unmetNeedRaw,
    unmetNeedMaterial,
  } = fundingShortfallForYear(
    totalWithdrawal,
    taxCost,
    penaltyCost,
    state,
    afterTaxNeed,
    surplusCredit,
    routedUnmetNeed,
    taxRates,
  );

  const { irmaaCost, irmaaPaid, acaSubsidyPreserved, acaMagiHeadroom } =
    yearCliffChecks(
      incomeHistory,
      income,
      enableIrmaaAwareness,
      filingStatus,
      personsAge65Plus,
      rothConversionAmount,
      grownIrmaaBracketsForCheck,
      input,
      routeWarnings,
      enableAcaAwareness,
      householdSize,
      fplGrowthFactor,
      taxRates,
    );

  const { decumBrokerageContrib, decumContribByAccount, decumRampAmount } =
    decumulationPortfolioContributions(
      input,
      yearIndex,
      state,
      ctx,
      indKey,
      indAccts,
      indBal,
    );

  const { decIndYearBalances, yearEnd } = closeDecumulationYear(
    returnRate,
    balances,
    acctBal,
    state,
    spendingState,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indBal,
    ctx,
    decumContribByAccount,
    indBasis,
    indParentCat,
    decIndWithdrawal,
    basisDraws,
    brokBasis,
    eligibility,
    routeWarnings,
    year,
    age,
  );

  const yearProjection: EngineDecumulationYear = {
    year,
    age,
    phase: "decumulation",
    projectedExpenses: roundToCents(state.projectedExpenses),
    spending: roundToCents(
      deliveredAfterTax -
        irmaaPaid -
        (config.rmdExcessHandling === "reinvest" ? rmdExcessAmount : 0) +
        ssIncome,
    ),
    withdrawalSized: state.portfolioWithdrawal !== null,
    budgetOnlyExpenses: roundToCents(state.budgetOnlyExpenses),
    hasBudgetOverride: budgetOverrideMap.has(year),
    brokerageContribution: decumBrokerageContrib,
    brokerageRampContribution: decumRampAmount,
    targetWithdrawal,
    config,
    slots,
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    taxCost,
    // On the withdrawal: tax on Social Security is owed whether or not
    // anything is withdrawn (`ssTaxCost`, shown on its own line).
    effectiveTaxRate:
      totalWithdrawal > 0 ? (taxCost - ssTaxCost) / totalWithdrawal : 0,
    ssTaxCost,
    ssIncome,
    ssIncomeByPerson,
    afterTaxNeed,
    grossUpFactor,
    estTraditionalPortion,
    bracketTraditionalCap: routeResult.traditionalCap,
    standardDeduction: grownStandardDeduction,
    discretionaryTierBreakdown: routeResult.tierBreakdown,
    rothBasisCapacity: routeResult.rothBasisCapacity,
    brokerageZeroLtcgCapacity: routeResult.brokerageZeroLtcgCapacity,
    unmetNeed: unmetNeedRaw,
    unmetNeedMaterial,
    shortfallMaterialityFloor,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
    penaltyCost,
    deliveredAfterTax,
    penaltyLockedStillExcluded: eligibility
      ? roundToCents(
          sumBy(
            getAllCategories().filter((c) => nonMedicalPenaltyRate(c) == null),
            (c) => eligibility.penaltyExposedTotalStillExcluded[c],
          ),
        )
      : undefined,
    preWithdrawalAcctBal,
    retirementBalance: yearEnd.retirementBalance,
    allAccountsBalance: yearEnd.allAccountsBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: decIndYearBalances,
    returnRate,
    annualizedReturnRate: returnRate,
    rmdAmount,
    rmdByPerson,
    rmdDivisor,
    priorYearEndTradBalance,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    ...(ownerRmd && ownerRmd.rmdReassignedAmount > 0
      ? { rmdReassignedAmount: ownerRmd.rmdReassignedAmount }
      : {}),
    rmdExcessAmount,
    rmdSmoothingShortfall,
    qcdAmount: totalQcd,
    qcdByPerson: qcdByPerson.length > 0 ? qcdByPerson : undefined,
    taxableSS,
    ltcgRate: postConversionLtcgRate,
    rothConversionAmount,
    rothConversionTaxCost,
    rothConversionIrmaaCapped,
    strategyAction,
    niitAmount,
    irmaaCost,
    ...(irmaaPaid > 0 ? { irmaaPaid } : {}),
    acaSubsidyPreserved,
    acaMagiHeadroom,
    warnings: routeWarnings,
  };

  state.projectionByYear.push(yearProjection);
}
