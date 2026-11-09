/**
 * A fund's total-return series from raw closes: (close + distribution) × split ÷
 * previous close, chained forward from the window's first day, so a later
 * distribution never changes an earlier day. Only ratios between days mean anything.
 */
import type { DailyClose } from "../accounts/current-balances";

export type RawClose = {
  date: string;
  close: number;
  divCash: number;
  splitFactor: number;
};

export function totalReturnSeries(
  rows: readonly RawClose[],
): Map<string, DailyClose> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, DailyClose>();
  let prev: RawClose | null = null;
  let adj = 0;
  for (const r of sorted) {
    adj =
      prev === null
        ? r.close
        : (adj * ((r.close + r.divCash) * r.splitFactor)) / prev.close;
    out.set(r.date, { close: r.close, adjClose: adj });
    prev = r;
  }
  return out;
}
