/**
 * RMD-Based Spending — Morningstar Method 2.
 *
 * Withdraw based on the IRS Required Minimum Distribution factor
 * for the retiree's age, scaled by a multiplier. Pre-RMD-age falls
 * back to fixed-real spending.
 * SWR: 5.4% (40/60 portfolio, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
import { getRmdFactor } from "../../config/rmd-tables";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  RmdSpendingParams,
} from "./spending-strategy";

export function applyRmdSpending(
  params: RmdSpendingParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const { portfolioBalance, age } = input;
  const rmdMultiplier = (params as RmdSpendingParams).rmdMultiplier ?? 1.0;

  const factor = getRmdFactor(age);

  // Pre-RMD age: fall back to fixed-real spending (orchestrator already inflated)
  if (factor === null) {
    return {
      projectedExpenses: input.projectedExpenses,
      action: null,
      updatedState: {},
    };
  }

  // spending = totalBalance / uniformLifetimeFactor × multiplier
  const spending = roundToCents((portfolioBalance / factor) * rmdMultiplier);

  return {
    projectedExpenses: spending,
    action: "rmd_based",
    updatedState: {},
  };
}
