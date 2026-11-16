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
import { sizeYearContributions } from "./year-contributions";
import {
  creditYearContributions,
  distributeYearContributions,
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
    holdsAccounts,
    indAccounts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    firstYearFraction,
    OVERFLOW_CATEGORY,
  } = ctx;
  const {
    balances,
    accountBalance,
    activeEmployerMatchByParentCat,
    accumulationDefaults,
    indBalance,
    indBasis,
    brokBasis,
    specToAccount,
    accountsWithSpecs,
  } = state;

  const {
    currentSalary,
    limitGrowthRate,
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

  const {
    proRate,
    targetContribution,
    personPay,
    slots,
    routeWarnings,
    rateCeilingScale,
    totalEmployee,
    totalEmployer,
    totalRoth,
    totalTraditional,
    overflowToBrokerage,
    totalTaxAdvSpace,
    rampAmount,
    gapNeed,
    contributionSpecs,
  } = sizeYearContributions(ctx, state, setup, { yearIndex, config, lgf });
  creditYearContributions(
    slots,
    balances,
    accountBalance,
    rampAmount,
    OVERFLOW_CATEGORY,
    indAccounts,
    indKey,
    indBalance,
    brokBasis,
    config,
    ctx,
    state,
  );
  const { indContributions, indMatch, indIntentional, indOverflow, indRamp } =
    distributeYearContributions(
      holdsAccounts,
      contributionSpecs,
      indAccounts,
      indKey,
      indBalance,
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
    ctx,
    state,
    gapNeed,
    year,
    routeWarnings,
  );

  // The year's growth, pro-rated in year 0 (UD-01).
  const effectiveReturn =
    yearIndex === 0
      ? Math.pow(1 + returnRate, firstYearFraction) - 1
      : returnRate;
  applyGrowth({ effectiveReturn, balances, accountBalance });
  const indGrowth = holdsAccounts
    ? applyIndividualGrowth(indAccounts, indKey, indBalance, effectiveReturn)
    : new Map<string, number>();

  const { goalWithdrawals } = brokerageGoalDraws(
    brokerageGoalsByYear,
    year,
    balances,
    holdsAccounts,
    indAccounts,
    indKey,
    indBalance,
    routeWarnings,
    brokBasis,
    decumulationDefaults,
    accountBalance,
    OVERFLOW_CATEGORY,
  );
  const { indYearBalances, allAccountsBalance, retirementBalance } =
    closeYearAccounts(
      holdsAccounts,
      indAccounts,
      indKey,
      indBalance,
      indParentCat,
      indContributions,
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
      accountBalance,
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
          Array.from(projectedSalaryByPerson.entries()).map(([pid, salary]) => [
            pid,
            roundToCents(salary),
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
    balanceByAccount: cloneAccountBalances(accountBalance),
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
