/**
 * Constant Percentage (Morningstar Method 5): a fixed share of the current balance each year,
 * floored at floorPercent of the initial withdrawal. SWR 5.7% (40/60, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
import {
  DEFAULT_STRATEGY_WITHDRAWAL_PERCENT,
  DEFAULT_STRATEGY_FLOOR_PERCENT,
} from "../../constants";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  ConstantPercentageParams,
} from "./spending-strategy";

export function applyConstantPercentage(
  params: ConstantPercentageParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const { portfolioBalance, crossYearState } = input;
  const p = params as ConstantPercentageParams;
  const withdrawalPercent =
    p.withdrawalPercent ?? DEFAULT_STRATEGY_WITHDRAWAL_PERCENT;
  const floorPercent = p.floorPercent ?? DEFAULT_STRATEGY_FLOOR_PERCENT;

  // First decumulation year: capture initial amount
  if (crossYearState.initialWithdrawalAmount === null) {
    const initial = roundToCents(portfolioBalance * withdrawalPercent);
    return {
      projectedExpenses: initial,
      amountKind: "portfolio_withdrawal",
      action: null,
      updatedState: { initialWithdrawalAmount: initial },
    };
  }

  const raw = portfolioBalance * withdrawalPercent;
  // Nominal floor: prevents severe spending cuts relative to initial withdrawal.
  // Kept nominal (not inflation-adjusted) to preserve the self-correcting property
  // — rate-based strategies must never force withdrawals above what the portfolio sustains.
  const floor = crossYearState.initialWithdrawalAmount * floorPercent;
  const floorApplied = raw < floor;
  const spending = roundToCents(Math.max(raw, floor));

  return {
    projectedExpenses: spending,
    amountKind: "portfolio_withdrawal",
    action: floorApplied ? "floor_applied" : null,
    updatedState: {},
  };
}
