/**
 * A fund's own price at each close, for funds with no public ticker: the
 * institution reports each holding's shares and value, and value ÷ shares
 * is the fund's unit price on the close that report shows. Never a
 * stand-in's or an index's price — a similar mix doesn't move the same.
 *
 * Guarded so a report can't make up a move:
 * - a value rounded to the cent leaves too much error on a small position;
 * - a value left over from an earlier day while the shares updated (or the
 *   same price on a new close — these funds price every session) is stale.
 *
 * Price only: a trust that pays a distribution out instead of reinvesting
 * it would show a drop on its ex-date. Collective trusts reinvest inside
 * the fund, so their unit price is their total return.
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
