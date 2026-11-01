/**
 * Variable Percentage Withdrawal (Bogleheads wiki, "Variable percentage
 * withdrawal"; tests/fixtures/vpw-table.ts holds the published table).
 *
 * Each year withdraw a percentage of the portfolio balance: the annuity-due
 * payment that would spend the balance by the table's end age at the
 * portfolio's expected real return —
 *   rate = r / ((1 − (1 + r)^−n) (1 + r)),  n = endAge − age,
 *   r = stocks × stockReturn + bonds × bondReturn.
 * With the defaults (100, 5.0%, 1.9%) this is the published VPW table to
 * the tenth of a percent. Age is the younger spouse's. "The withdrawal
 * percentage stops growing when it reaches 10%" — the cap, which also
 * covers ages at or past the end age.
 *
 * The amount is the gross portfolio withdrawal; Social Security and
 * pensions come on top (unless the household's `ssInAmount` switch says
 * otherwise — see pre-year-setup).
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
