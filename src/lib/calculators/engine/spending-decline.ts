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
  const annualDeclineRate =
    (params as SpendingDeclineParams).annualDeclineRate ?? 0.02;

  // First decumulation year: capture initial amount
  if (crossYearState.initialWithdrawalAmount === null) {
    return {
      projectedExpenses: input.projectedExpenses,
      action: null,
      updatedState: {
        initialWithdrawalAmount: input.projectedExpenses,
        decumulationYearCount: 1,
      },
    };
  }

  // spending = initialAmount × (1 - rate)^yearCount
  // This replaces the orchestrator's inflation-adjusted expenses entirely
  const yearCount = crossYearState.decumulationYearCount;
  const spending = roundToCents(
    crossYearState.initialWithdrawalAmount *
      Math.pow(1 - annualDeclineRate, yearCount),
  );

  return {
    projectedExpenses: spending,
    action: yearCount > 0 ? "decline" : null,
    updatedState: {
      decumulationYearCount: yearCount + 1,
    },
  };
}
