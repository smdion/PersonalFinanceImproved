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
  const { portfolioBalance, age, primaryPersonAge } = input;
  const rmdMultiplier = (params as RmdSpendingParams).rmdMultiplier ?? 1.0;

  // Use primary person's age for RMD factor lookup (not household average)
  const factor = getRmdFactor(primaryPersonAge ?? age);

  // Pre-RMD age: fall back to inflation-adjusted budget spending.
  // The orchestrator skips inflation for usesPostRetirementRaise=false strategies,
  // so we apply one year of CPI growth to maintain real purchasing power.
  // (Only one year because projectedExpenses carries forward prior years' output.)
  if (factor === null) {
    const yearCount = input.crossYearState.decumulationYearCount;
    const inflated =
      yearCount > 0
        ? roundToCents(input.projectedExpenses * (1 + input.cpiInflation))
        : input.projectedExpenses;
    return {
      projectedExpenses: inflated,
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
