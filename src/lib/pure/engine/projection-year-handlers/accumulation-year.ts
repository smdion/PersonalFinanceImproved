/** One working year, as its stages in order. */
import type { EngineAccumulationYear } from "../types/projection-result";
import { roundToCents } from "../../../utils/math";
import { resolveAccumulationConfig } from "../override-resolution";
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import { cloneAccountBalances } from "../balance-utils";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { brokerageGoalDraws, yearGapDraw } from "./goal-draws";
import { updatePerPersonTradBalance } from "./helpers";
import { yearContributionTarget, yearZeroBasis } from "./contribution-target";
import { routeYearSlots, yearContributionLimits } from "./contribution-slots";
import {
  creditYearContributions,
  distributeYearContributions,
  yearContributionTotals,
} from "./contribution-credits";
import { closeYearAccounts } from "./year-end-accounts";

/**
 * Runs a single working year: mutates state in place and pushes the year's
 * row to state.projectionByYear.
 */
export function runAccumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
  setup: PreYearSetup,
): void {
  const {
    age,
    year,
    returnRate,
    effectiveSalary: projectedSalary,
    effectiveSalaryByPerson: projectedSalaryByPerson,
    hasBonusAdjustment,
  } = setup;
  const {
    input,
    salaryOverrideMap,
    perPersonSalaryOverrides,
    budgetOverrideMap,
    brokerageGoalsByYear,
    sortedAccOverrides,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    firstYearFraction,
    OVERFLOW_CATEGORY,
    TAX_ADVANTAGED,
  } = ctx;
  // This year's specs: someone not at work this year has theirs zeroed.
  const contributionSpecs = setup.yearSpecs ?? state.contributionSpecs;
  const {
    balances,
    acctBal,
    activeEmployerMatchRateByCategory,
    activeBaseYearContributions,
    activeBaseYearEmployerMatch,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    indBal,
    indBasis,
    brokBasis,
    specToAccount,
    accountsWithSpecs,
  } = state;

  const {
    currentSalary,
    limitGrowthRate,
    irsLimitCaps,
    brokerageContributionRamp,
    decumulationDefaults,
    retirementYear,
  } = input;

  const config = resolveAccumulationConfig(
    year,
    accumulationDefaults,
    sortedAccOverrides,
  );

  // IRS limits grow annually
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex);

  const { useRealContribs, proRate, lateYearCut, totalLateYearCut } =
    yearZeroBasis(
      yearIndex,
      setup,
      activeBaseYearContributions,
      activeBaseYearEmployerMatch,
      firstYearFraction,
      contributionSpecs,
    );
  const { targetContribution, yearEmployerMatch, personPay, contribution } =
    yearContributionTarget(
      useRealContribs,
      activeBaseYearContributions,
      proRate,
      totalLateYearCut,
      contributionSpecs,
      projectedSalary,
      lgf,
      config,
      activeBaseYearEmployerMatch,
      activeEmployerMatchRateByCategory,
      input,
      hasPerPersonSalary,
      projectedSalaryByPerson,
      currentSalary,
      setup,
      state,
    );
  const { capped, yearLimits } = yearContributionLimits(
    contributionSpecs,
    year,
    irsLimitCaps,
    lgf,
    projectedSalary,
    currentSalary,
    personPay,
    yearEmployerMatch,
    hasPerPersonSalary,
    projectedSalaryByPerson,
    useRealContribs,
    activeBaseYearContributions,
  );
  const { slots, routeWarnings, specOverflow, rateCeilingScale } =
    routeYearSlots(
      useRealContribs,
      activeBaseYearContributions,
      yearEmployerMatch,
      proRate,
      lateYearCut,
      yearLimits,
      config,
      contributionSpecs,
      capped,
      contribution,
      projectedSalary,
      targetContribution,
    );
  const {
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    overflowToBrokerage,
    totalTaxAdvSpace,
  } = yearContributionTotals(
    slots,
    useRealContribs,
    contributionSpecs,
    specOverflow,
    state,
    projectedSalary,
    currentSalary,
    TAX_ADVANTAGED,
    year,
    age,
  );
  const { rampAmount } = creditYearContributions(
    slots,
    balances,
    acctBal,
    yearIndex,
    brokerageContributionRamp,
    contribution,
    OVERFLOW_CATEGORY,
    indAccts,
    indKey,
    indBal,
    brokBasis,
    config,
    ctx,
    state,
  );
  const { indContribs, indMatch, indIntentional, indOverflow, indRamp } =
    distributeYearContributions(
      hasIndividualAccounts,
      contributionSpecs,
      indAccts,
      indKey,
      indBal,
      brokBasis,
      slots,
      indParentCat,
      specToAccount,
      accountsWithSpecs,
      projectedSalary,
      currentSalary,
      personPay,
      limitGrowthRate,
      yearIndex,
      proRate,
      overflowToBrokerage,
      rampAmount,
      activeEmployerMatchByParentCat,
      indBasis,
    );
  const { gapRun, gapDraw } = yearGapDraw(
    setup,
    ctx,
    state,
    year,
    age,
    proRate,
    hasPerPersonSalary,
    projectedSalaryByPerson,
    projectedSalary,
    totalEmployee,
    rampAmount,
    totalTraditional,
    routeWarnings,
  );

  // The year's growth, pro-rated in year 0 (UD-01).
  const effectiveReturn =
    yearIndex === 0
      ? Math.pow(1 + returnRate, firstYearFraction) - 1
      : returnRate;
  applyGrowth({ effectiveReturn, balances, acctBal });
  const indGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, effectiveReturn)
    : new Map<string, number>();

  const { goalWithdrawals } = brokerageGoalDraws(
    brokerageGoalsByYear,
    year,
    balances,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indBal,
    routeWarnings,
    brokBasis,
    decumulationDefaults,
    acctBal,
    OVERFLOW_CATEGORY,
  );
  const { indYearBalances, allAccountsBalance, retirementBalance } =
    closeYearAccounts(
      hasIndividualAccounts,
      indAccts,
      indKey,
      indBal,
      indParentCat,
      indContribs,
      indMatch,
      indGrowth,
      indIntentional,
      indOverflow,
      indRamp,
      indBasis,
      brokBasis,
      gapRun,
      routeWarnings,
      balances,
      acctBal,
      year,
      retirementYear,
      age,
    );

  const yearProjection: EngineAccumulationYear = {
    year,
    age,
    phase: "accumulation",
    projectedSalary: roundToCents(projectedSalary),
    projectedSalaryByPerson: hasPerPersonSalary
      ? Object.fromEntries(
          Array.from(projectedSalaryByPerson.entries()).map(([pid, sal]) => [
            pid,
            roundToCents(sal),
          ]),
        )
      : undefined,
    projectedExpenses: roundToCents(state.projectedExpenses),
    hasSalaryOverride:
      salaryOverrideMap.has(year) || perPersonSalaryOverrides.has(year),
    hasBonusAdjustment,
    hasBudgetOverride: budgetOverrideMap.has(year),
    proRateFraction:
      yearIndex === 0 && firstYearFraction < 1 ? firstYearFraction : null,
    targetContribution,
    config,
    slots,
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    rateCeilingScale,
    overflowToBrokerage,
    brokerageRampContribution: rampAmount,
    totalTaxAdvSpace,
    brokerageGoalWithdrawals: goalWithdrawals,
    ...(gapDraw ? { gapDraw, savingStopped: setup.savingStopped } : {}),
    retirementBalance,
    allAccountsBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(acctBal),
    individualAccountBalances: indYearBalances,
    returnRate: effectiveReturn,
    annualizedReturnRate:
      yearIndex === 0 && firstYearFraction < 1
        ? Math.pow(1 + effectiveReturn, 1 / firstYearFraction) - 1
        : returnRate,
    warnings: routeWarnings,
  };

  state.priorYearEndTradBalance = balances.preTax;
  updatePerPersonTradBalance(ctx, state);

  state.projectionByYear.push(yearProjection);
}
