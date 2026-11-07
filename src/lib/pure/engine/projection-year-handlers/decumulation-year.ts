/**
 * runDecumulationYear — single-year decumulation-phase logic. Mutates state in
 * place and pushes a year projection to `state.projectionByYear`.
 */
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

// ---------------------------------------------------------------------------
// Decumulation year handler
// ---------------------------------------------------------------------------

/**
 * Run a single decumulation year. Mutates state in place and pushes
 * the year projection to state.projectionByYear.
 *
 * Logic copied exactly from projection.ts lines 1079-1539.
 */
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

  // Withdrawal-ordering eligibility --
  // per-account penalty-free/locked split for this projected year. Computed
  // once, here, BEFORE either routeForMode call site (this function's real
  // execution below and withdrawal-solver.ts's independent estimate) -- both
  // must see the exact same eligibility record, or the gross-up estimate
  // would target money the real router can't (or won't prefer to) reach,
  // desyncing the tax estimate from actual routing (the single-dispatch
  // invariant routeForMode exists to preserve). Computed unconditionally
  // when individual accounts exist -- Tier A (distributeWithdrawals) has no
  // config lever and always applies; routeForMode itself checks
  // config.avoidPenalizedWithdrawals before using this for Tier B. indAccts
  // already carry their own ruleOf55/rothBasisMeta/ownerBirthYear ("now"
  // data, threaded by build-engine-payload.ts Group 1.1); this recomputes
  // locked/eligible fresh for the current projected `year` via
  // projectRuleOf55. `indBasis` (tracked Roth basis follow-up) is passed
  // through so the gate reads the SAME running basis figure the UI shows
  // -- reading a stale snapshot for the gate while showing tracked basis
  // in the tooltip would be two numbers for one quantity (see
  // withdrawal-eligibility.ts's docblock).
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({ year, indAccts, indBal, indKey, indBasis })
    : undefined;
  // Portfolio-parented accounts (e.g. a taxable brokerage the
  // household doesn't consider part of the retirement plan) never fund
  // retirement spending need — computed once per year here, threaded to
  // every consumer that decides how much money is "available"
  // (routeForMode's two call sites, performRothConversion, enforceRmd, and
  // QCD's capacity/debit below) so they can't disagree with each other.
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

  // Tax gross-up: estimate tax from expected withdrawal routing, then
  // increase withdrawal so after-tax proceeds cover the expense need.
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
