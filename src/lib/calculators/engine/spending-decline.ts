/**
 * Spending Decline — Morningstar Method 4.
 *
 * Annual real spending declines by a fixed rate, reflecting reduced
 * consumption in later retirement per EBRI actual spending data.
 * SWR: 5.0% (40/60 portfolio, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  SpendingDeclineParams,
} from "./spending-strategy";

export function applySpendingDecline(
  params: SpendingDeclineParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const { crossYearState } = input;
  const { annualDeclineRate } = params as SpendingDeclineParams;

  // First decumulation year: capture initial amount
  // decumulationYearCount is 0 on first year (orchestrator increments after strategy runs)
  if (crossYearState.initialWithdrawalAmount === null) {
    return {
      projectedExpenses: input.projectedExpenses,
      action: null,
      updatedState: {
        initialWithdrawalAmount: input.projectedExpenses,
      },
    };
  }

  // spending = initialAmount × ((1 + CPI) × (1 - declineRate))^yearCount
  // This produces a REAL decline: spending grows with CPI (maintaining purchasing
  // power) but declines by the decline rate each year. With CPI=2.5% and rate=2%,
  // nominal spending grows ~0.45%/yr while real spending declines 2%/yr — matching
  // the EBRI data on actual retiree consumption patterns.
  const yearCount = crossYearState.decumulationYearCount;
  // In a trial, CPI varies by year: this year's rate raised to yearCount
  // would apply one year's inflation to every year since retirement.
  const realDeclineFactor = (1 + input.cpiInflation) * (1 - annualDeclineRate);
  const spending = roundToCents(
    crossYearState.initialWithdrawalAmount *
      (input.cpiGrowthSinceStart != null
        ? input.cpiGrowthSinceStart * Math.pow(1 - annualDeclineRate, yearCount)
        : Math.pow(realDeclineFactor, yearCount)),
  );

  return {
    projectedExpenses: spending,
    action: yearCount > 0 ? "decline" : null,
    updatedState: {},
  };
}
