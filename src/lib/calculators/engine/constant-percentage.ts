/**
 * Constant Percentage — Morningstar Method 5.
 *
 * Withdraw a fixed percentage of the current portfolio balance each year.
 * A floor prevents severe spending cuts — minimum is floorPercent of the
 * initial withdrawal amount. Self-correcting: can never fully deplete.
 * SWR: 5.7% (40/60 portfolio, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
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
  const withdrawalPercent = p.withdrawalPercent ?? 0.05;
  const floorPercent = p.floorPercent ?? 0.9;

  // First decumulation year: capture initial amount
  if (crossYearState.initialWithdrawalAmount === null) {
    const initial = roundToCents(portfolioBalance * withdrawalPercent);
    return {
      projectedExpenses: initial,
      action: null,
      updatedState: { initialWithdrawalAmount: initial },
    };
  }

  const raw = portfolioBalance * withdrawalPercent;
  const floor = crossYearState.initialWithdrawalAmount * floorPercent;
  const floorApplied = raw < floor;
  const spending = roundToCents(Math.max(raw, floor));

  return {
    projectedExpenses: spending,
    action: floorApplied ? "floor_applied" : null,
    updatedState: {},
  };
}
