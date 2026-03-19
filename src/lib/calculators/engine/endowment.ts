/**
 * Endowment — Morningstar Method 6.
 *
 * Withdraw a fixed percentage of the N-year rolling average portfolio
 * balance, with a floor to prevent severe cuts. Smooths volatility
 * like an endowment fund's spending rule.
 * SWR: 5.7% (40/60 portfolio, 90% success, 30 years).
 */
import { roundToCents } from "../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  EndowmentParams,
} from "./spending-strategy";

export function applyEndowment(
  params: EndowmentParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const { portfolioBalance, crossYearState } = input;
  const p = params as EndowmentParams;
  const withdrawalPercent = p.withdrawalPercent ?? 0.05;
  const rollingYears = p.rollingYears ?? 10;
  const floorPercent = p.floorPercent ?? 0.9;

  // Include current balance in history for the rolling average
  const history = [...crossYearState.balanceHistory, portfolioBalance];

  // First decumulation year: capture initial amount
  if (crossYearState.initialWithdrawalAmount === null) {
    const initial = roundToCents(portfolioBalance * withdrawalPercent);
    return {
      projectedExpenses: initial,
      action: null,
      updatedState: {
        initialWithdrawalAmount: initial,
        balanceHistory: history,
      },
    };
  }

  // Rolling average of the last N balances
  const window = history.slice(-rollingYears);
  const avg = window.reduce((sum, b) => sum + b, 0) / window.length;
  const raw = avg * withdrawalPercent;
  const floor = crossYearState.initialWithdrawalAmount * floorPercent;
  const floorApplied = raw < floor;
  const spending = roundToCents(Math.max(raw, floor));

  return {
    projectedExpenses: spending,
    action: floorApplied ? "floor_applied" : null,
    updatedState: {
      balanceHistory: history,
    },
  };
}
