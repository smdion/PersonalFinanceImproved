/**
 * Suggested cost basis for a taxable account: shares × reported average cost. A $1-priced
 * holding with no cost counts at value; any other leaves the suggestion incomplete.
 */
import { roundToCents, safeDivide } from "@/lib/utils/math";

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
    const price = safeDivide(value, h.shares, 0);
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
