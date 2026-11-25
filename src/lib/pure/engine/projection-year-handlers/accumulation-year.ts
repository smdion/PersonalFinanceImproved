/** One working year, as its stages in order. */
import type { EngineAccumulationYear } from "../types/projection-result";
import { roundToCents } from "../../../utils/math";
import { resolveAccumulationConfig } from "../override-resolution";
import { cloneAccountBalances } from "../balance-utils";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { updatePerPersonTradBalance } from "./helpers";
import { sizeYearContributions } from "./year-contributions";
import { runWorkingYearFlows } from "./working-year-flows";
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
    sortedAccOverrides,
    ledgerRuns,
    indAccounts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    firstYearFraction,
  } = ctx;
  const { balances, accountBalance, accumulationDefaults } = state;
  const { indBalance, indBasis, brokBasis } = state;

  const { limitGrowthRate } = input;

  const config = resolveAccumulationConfig(
    year,
    accumulationDefaults,
    sortedAccOverrides,
  );
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex); // IRS limits' growth

  const sized = sizeYearContributions(ctx, state, setup, {
    yearIndex,
    config,
    lgf,
  });
  const { targetContribution, slots, routeWarnings, rateCeilingScale } = sized;
  const { totalEmployee, totalEmployer, totalRoth, totalTraditional } = sized;
  const { overflowToBrokerage, totalTaxAdvSpace, rampAmount } = sized;
  const flows = runWorkingYearFlows(ctx, state, setup, {
    yearIndex,
    config,
    sized,
  });
  const { gapDraw, effectiveReturn, goalWithdrawals } = flows;
  const { indYearBalances, allAccountsBalance, retirementBalance } =
    closeYearAccounts(
      ledgerRuns,
      ctx.holdsRealAccount,
      indAccounts,
      indKey,
      indBalance,
      indParentCat,
      flows.individualContributions,
      flows.individualMatch,
      flows.individualGrowth,
      flows.individualIntentional,
      flows.individualOverflow,
      flows.individualRamp,
      indBasis,
      brokBasis,
      flows.gapRun,
      routeWarnings,
      balances,
      accountBalance,
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
