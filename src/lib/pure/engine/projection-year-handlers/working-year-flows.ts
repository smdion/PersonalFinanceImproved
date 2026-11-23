/** A working year's flows, in order: contributions, the gap draw, growth, goal draws. */
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import type { resolveAccumulationConfig } from "../override-resolution";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import { brokerageGoalDraws, yearGapDraw } from "./goal-draws";
import type { sizeYearContributions } from "./year-contributions";
import {
  creditYearContributions,
  distributeYearContributions,
} from "./contribution-credits";
import { recordIrmaaTaxYear } from "./irmaa-lookback";
import { fullYearWages, workingYearIncome } from "./working-year-wages";
import { settle } from "./settle";

/** The year's contributions credited and spread to each account, the gap
 *  year's draw, the year's growth and the brokerage goals' draws. */
export function runWorkingYearFlows(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  setup: PreYearSetup,
  terms: {
    yearIndex: number;
    config: ReturnType<typeof resolveAccumulationConfig>;
    sized: ReturnType<typeof sizeYearContributions>;
  },
) {
  const { yearIndex, config, sized } = terms;
  const { year, returnRate, effectiveSalary: projectedSalary } = setup;
  const {
    holdsAccounts,
    indAccounts: individualAccounts,
    indKey: individualKey,
    indParentCat: individualParentCategory,
    brokerageGoalsByYear,
    firstYearFraction,
    OVERFLOW_CATEGORY,
  } = ctx;
  const { currentSalary, limitGrowthRate, decumulationDefaults } = ctx.input;
  const {
    balances,
    accountBalance,
    activeEmployerMatchByParentCat: activeEmployerMatchByParentCategory,
    indBalance: individualBalance,
    indBasis: individualBasis,
    brokBasis: brokerageBasis,
    specToAccount,
    accountsWithSpecs,
  } = state;
  const { slots, rampAmount, personPay, proRate, lateYearCut } = sized;
  const { overflowToBrokerage, contributionSpecs, gapNeed, routeWarnings } =
    sized;

  creditYearContributions(
    slots,
    balances,
    accountBalance,
    rampAmount,
    OVERFLOW_CATEGORY,
    individualAccounts,
    individualKey,
    individualBalance,
    brokerageBasis,
    config,
    ctx,
    state,
  );
  const {
    indContributions: individualContributions,
    indMatch: individualMatch,
    indIntentional: individualIntentional,
    indOverflow: individualOverflow,
    indRamp: individualRamp,
  } = distributeYearContributions(
    holdsAccounts,
    contributionSpecs,
    individualAccounts,
    individualKey,
    individualBalance,
    brokerageBasis,
    slots,
    individualParentCategory,
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
    activeEmployerMatchByParentCategory,
    individualBasis,
  );
  settle(state, "accumulation.contributions");
  const { gapRun, gapDraw } = yearGapDraw(ctx, state, gapNeed, routeWarnings);
  settle(state, "accumulation.gapDraw");
  const wages = fullYearWages(projectedSalary, slots, proRate, lateYearCut);
  const income = workingYearIncome(wages, gapRun?.income);
  recordIrmaaTaxYear(state.irmaaTaxYears, year, income);

  // The year's growth, pro-rated in year 0 (UD-01).
  const effectiveReturn =
    yearIndex === 0
      ? Math.pow(1 + returnRate, firstYearFraction) - 1
      : returnRate;
  applyGrowth({ effectiveReturn, balances, accountBalance });
  const individualGrowth = holdsAccounts
    ? applyIndividualGrowth(
        individualAccounts,
        individualKey,
        individualBalance,
        effectiveReturn,
      )
    : new Map<string, number>();
  settle(state, "accumulation.growth");

  const { goalWithdrawals } = brokerageGoalDraws(
    brokerageGoalsByYear,
    year,
    balances,
    holdsAccounts,
    individualAccounts,
    individualKey,
    individualBalance,
    routeWarnings,
    brokerageBasis,
    decumulationDefaults,
    accountBalance,
    OVERFLOW_CATEGORY,
  );
  settle(state, "accumulation.goalDraws");
  // Nothing writes between the goal draws and the year's close, whose
  // rows are read before its reconcile.
  settle(state, "accumulation.beforeReconcile");
  return {
    individualContributions,
    individualMatch,
    individualIntentional,
    individualOverflow,
    individualRamp,
    individualGrowth,
    gapRun,
    gapDraw,
    effectiveReturn,
    goalWithdrawals,
  };
}
