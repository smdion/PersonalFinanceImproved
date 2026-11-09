/**
 * Unit price (value ÷ shares) at each close for funds with no public ticker,
 * never a stand-in's. Skips small positions with too much rounding error and stale
 * values; price only (collective trusts reinvest, so it is their total return).
 */
import { IMPLIED_PRICE_MAX_ERROR } from "@/lib/config/fund-prices";
import type { DailyClose } from "../accounts/current-balances";

export type DatedHoldingReport = {
  feedId: number;
  /** The close the report shows. */
  day: string;
  shares: number;
  value: number | null;
};

/** Half a cent: how far a value rounded to the cent can be off. */
const VALUE_ROUNDING = 0.005;

export function impliedUnitPrices(
  reports: readonly DatedHoldingReport[],
): Map<string, DailyClose> {
  const byFeed = new Map<number, Map<string, DatedHoldingReport>>();
  for (const r of reports) {
    const days = byFeed.get(r.feedId) ?? new Map<string, DatedHoldingReport>();
    days.set(r.day, r); // the day's last report
    byFeed.set(r.feedId, days);
  }
  // Per day, the largest position's price: the least rounding.
  const best = new Map<string, { price: number; value: number }>();
  for (const days of byFeed.values()) {
    let prev: { shares: number; value: number; price: number } | null = null;
    for (const [day, r] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      if (r.value === null || r.shares <= 0 || r.value <= 0) continue;
      if (VALUE_ROUNDING / r.value > IMPLIED_PRICE_MAX_ERROR) continue;
      const price = r.value / r.shares;
      const stale =
        prev !== null &&
        ((r.value === prev.value && r.shares !== prev.shares) ||
          Math.abs(price - prev.price) <= price * 1e-12);
      prev = { shares: r.shares, value: r.value, price };
      if (stale) continue;
      const have = best.get(day);
      if (!have || r.value > have.value)
        best.set(day, { price, value: r.value });
    }
  }
  return new Map(
    [...best].map(([day, { price }]) => [
      day,
      { close: price, adjClose: price },
    ]),
  );
}
