/**
 * Variable Percentage Withdrawal (Bogleheads): rate = r / ((1 − (1 + r)^−n) (1 + r)),
 * n = endAge − younger spouse's age, r = blended real return; capped at 10%.
 * Gross withdrawal; SS and pensions come on top unless `ssInAmount` says otherwise.
 */
import { roundToCents } from "../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  VpwParams,
} from "./spending-strategy";

/** The VPW percentage for `n` withdrawals left at real return `r`. */
export function vpwRate(r: number, n: number): number {
  if (n <= 0) return 1;
  if (Math.abs(r) < 1e-12) return 1 / n;
  return r / ((1 - Math.pow(1 + r, -n)) * (1 + r));
}

export function applyVpw(
  params: VpwParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const p = params as VpwParams;
  const age = input.youngestAge ?? input.age;
  const stocks = Math.min(1, Math.max(0, input.stockShare ?? p.stockShare));
  const r = stocks * p.stockReturn + (1 - stocks) * p.bondReturn;
  const n = Math.floor(p.endAge - age);
  const rate = Math.min(p.cap, vpwRate(r, n));
  return {
    projectedExpenses: roundToCents(input.portfolioBalance * rate),
    amountKind: "portfolio_withdrawal",
    action: rate === p.cap ? "vpw_cap" : null,
    updatedState: {},
  };
}
