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
  DecumulationYear,
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { rmdIncomeByOwner } from "./decumulation-income";
import { enforceYearRmd, qcdStep } from "./rmd-step";
import {
  priceYearTax,
  pricedYearParts,
  settleYearDraws,
  yearRothConversion,
} from "./tax-year-settlement";
import { repriceConversionYear } from "./conversion-year-reprice";
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
  const { age, year, returnRate, strategyAction, retirementBalance } = setup;
  const {
    input,
    budgetOverrideMap,
    sortedDecumulationOverrides,
    hasIndividualAccounts,
    indAccounts,
    indKey,
  } = ctx;
  const {
    balances,
    accountBalance,
    priorYearEndTradBalance,
    indBalance,
    indBasis,
    brokBasis,
  } = state;

  const { decumulationDefaults, perPersonBirthYears } = input;

  const config = resolveDecumulationConfig(
    year,
    decumulationDefaults,
    sortedDecumulationOverrides,
  );

  // Each account's penalty-free/locked split this year, computed once for
  // both routeForMode sites (the solver's estimate and the real draw), from
  // the running Roth basis the UI shows.
  const eligibility = hasIndividualAccounts
    ? computeWithdrawalEligibility({
        year,
        indAccounts,
        indBalance,
        indKey,
        indBasis,
      })
    : undefined;
  // Portfolio-parented money never funds retirement spending: one exclusion
  // a year, read by every step that decides what's available.
  const { nonRetirement } = setup;

  // Reconciliation check: accountBalance Roth total should match balances.taxFree
  const accountBalanceRothTotal = getAllCategories().reduce((s, cat) => {
    const b = accountBalance[cat];
    return s + (b.structure === "roth_traditional" ? b.roth : 0);
  }, 0);
  const rothDivergence =
    Math.abs(accountBalanceRothTotal - balances.taxFree) > 1
      ? `[DIAG] Roth divergence: acctBal.roth=${accountBalanceRothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - accountBalanceRothTotal).toFixed(0)}`
      : null;

  // Social Security income reduces withdrawal need (per person from each
  // one's own start age).
  const { ssIncome, ssIncomeByPerson } = socialSecurityForYear(
    input,
    year,
    age,
    ctx.inflation.growth(year - input.asOfDate.getFullYear()),
  );
  const owed = rmdIncomeByOwner(ctx, state, year);
  const { rmdByPerson } = owed;

  const qcd = qcdStep(ctx, state, year, config);
  const { totalQcd, qcdByPerson } = qcd;

  // The brokerage basis ratio of this year's retirement withdrawals: the
  // Retirement brokerages' own (start of year). One ratio for the
  // estimate, the ranking and the real tax.
  const retirementBasisRatio = hasIndividualAccounts
    ? retirementBrokerageBasisRatio(indAccounts, indKey, indBalance, brokBasis)
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

  const tables = growYearTaxTables(ctx, state, year, age);
  const { grownStandardDeduction } = tables;

  const personsAge65Plus = countReachingAgeRule(
    perPersonBirthYears,
    age,
    "medicare",
    year,
  );
  const thisYear: DecumulationYear = {
    year,
    age,
    setup,
    config,
    eligibility,
    taxRates,
    tables,
    ssIncome,
    personsAge65Plus,
    retirementBasisRatio,
  };
  const need = yearNeed(ctx, state, thisYear);
  const { afterTaxNeed, targetWithdrawal } = need;

  const route = routeYearDraw(ctx, state, thisYear, need, rothDivergence);
  const {
    preWithdrawalAcctBal,
    routeResult,
    slots,
    routeWarnings,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
  } = route;

  const rmd = enforceYearRmd(ctx, state, thisYear, route, owed, qcd);
  const {
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    rmdDivisor,
    ownerRmd,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    rmdAmount,
  } = rmd;

  const drawn = distributeYearDraws(ctx, state, thisYear, { route, rmd });

  const priced = priceYearTax(ctx, state, thisYear, {
    need,
    route,
    rmd,
    drawn,
  });
  const { taxableSS } = priced;
  const parts = pricedYearParts(state, { need, route, rmd, priced });
  const { penaltyCost, ssTaxCost, grossUpFactor } = parts;

  const settled = { need, route, rmd, drawn, priced, parts };
  const { rmdExcessAmount } = settleYearDraws(ctx, state, thisYear, settled);

  const conversion = yearRothConversion(ctx, state, thisYear, settled);
  const {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  } = conversion;

  const repriced = repriceConversionYear(ctx, thisYear, {
    rmd,
    priced,
    parts,
    conversion,
  });
  const { taxCost, postConversionLtcgRate, niitAmount } = repriced;
  const flow = { ...settled, conversion, repriced };

  const {
    deliveredAfterTax,
    shortfallMaterialityFloor,
    unmetNeedRaw,
    unmetNeedMaterial,
  } = fundingShortfallForYear(state, thisYear, flow);

  const { irmaaCost, irmaaPaid, acaSubsidyPreserved, acaMagiHeadroom } =
    yearCliffChecks(ctx, state, thisYear, flow);

  const contributions = decumulationPortfolioContributions(
    ctx,
    state,
    yearIndex,
  );
  const { decumBrokerageContribution, decumRampAmount } = contributions;

  const { decumulationIndYearBalances, yearEnd } = closeDecumulationYear(
    ctx,
    state,
    thisYear,
    { ...flow, contributions },
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
    brokerageContribution: decumBrokerageContribution,
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
    balanceByAccount: cloneAccountBalances(accountBalance),
    individualAccountBalances: decumulationIndYearBalances,
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
