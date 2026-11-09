/**
 * RMD-Based Spending (Morningstar Method 2): the IRS RMD factor for the age times a multiplier;
 * fixed-real spending before RMD age. SWR 5.4% (40/60 portfolio, 90% success, 30 years).
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
  const { rmdMultiplier } = params as RmdSpendingParams;

  // Use primary person's age for RMD factor lookup (not household average)
  const factor = getRmdFactor(primaryPersonAge ?? age);

  // Pre-RMD age: inflation-adjusted budget spending. The orchestrator skips
  // inflation for this strategy and projectedExpenses carries last year's
  // output, so apply one year of CPI here.
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
    amountKind: "portfolio_withdrawal",
    action: "rmd_based",
    updatedState: {},
  };
}
