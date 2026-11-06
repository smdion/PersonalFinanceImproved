/**
 * Suggested cost basis for a taxable account from what its institution
 * reports: shares × average cost per share, summed over current holdings.
 * Pure; a suggestion the household confirms.
 *
 * A holding with no reported average cost but a steady $1 price (a money
 * market or settlement fund) cost what it's worth. Any other holding
 * without a cost leaves the suggestion incomplete — its value is reported
 * so the household can judge.
 */
import { roundToCents } from "@/lib/utils/math";

/** Price within this of $1 counts as a stable-value (money market) holding. */
const STABLE_PRICE_TOLERANCE = 0.005;

export type CostHolding = {
  shares: number;
  avgCostPerShare: number | null;
  reportedMarketValue: number | null;
};

export function suggestCostBasis(holdings: readonly CostHolding[]): {
  suggested: number;
  /** Value of holdings with no known cost (0 when complete). */
  unknownValue: number;
  complete: boolean;
} | null {
  if (holdings.length === 0) return null;
  let suggested = 0;
  let unknownValue = 0;
  let known = 0;
  for (const h of holdings) {
    if (h.avgCostPerShare !== null) {
      suggested += h.shares * h.avgCostPerShare;
      known++;
      continue;
    }
    const value = h.reportedMarketValue ?? 0;
    const price = h.shares !== 0 ? value / h.shares : 0;
    if (h.shares > 0 && Math.abs(price - 1) <= STABLE_PRICE_TOLERANCE) {
      suggested += value;
      known++;
    } else unknownValue += value;
  }
  if (known === 0) return null;
  return {
    suggested: roundToCents(suggested),
    unknownValue: roundToCents(unknownValue),
    complete: unknownValue === 0,
  };
}
