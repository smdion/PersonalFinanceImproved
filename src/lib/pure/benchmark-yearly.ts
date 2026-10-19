/**
 * Yearly-resolution comparison: your yearly results next to the same money
 * put into an index on the same schedule. Pure.
 *
 * Same money, same schedule: the index starts from your opening balance,
 * receives each year's net deposits spread evenly across its months, and
 * any jump between one year's ending and the next year's opening balance
 * (rollovers, transfers recorded outside the yearly totals) at the start of
 * that year. What remains different is only what the money was invested in.
 *
 * Returns are money-weighted (Modified Dietz per year — the same
 * `computeReturn` the Performance page uses; IRR over a window). A window
 * shorter than a year is never annualized.
 */
import { computeReturn } from "./performance";
import { roundToCents } from "@/lib/utils/math";

export type YearlyResult = {
  year: number;
  begin: number;
  /** Money in: your + employer contributions + rollovers in. */
  contributions: number;
  /** Money out: distributions + fees. */
  outflows: number;
  gain: number;
  end: number;
};

/** Month-end total-return price by month, "YYYY-MM". */
export type MonthlyPrices = ReadonlyMap<string, number>;

export const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

export function previousMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

export type IndexYear = {
  year: number;
  begin: number;
  end: number;
  /** Months of the year priced (12 for full years). */
  months: number;
  returnPct: number | null;
};

/**
 * The index run for consecutive `years` (ascending). Stops at the first
 * month without a price (the current year is partial). Null when the
 * index has no price for the starting month.
 */
export function simulateIndex(
  years: readonly YearlyResult[],
  prices: MonthlyPrices,
): IndexYear[] | null {
  if (years.length === 0) return [];
  const [y0, m0] = previousMonth(years[0]!.year, 1);
  if (!prices.has(monthKey(y0, m0))) return null;
  let value = years[0]!.begin;
  const out: IndexYear[] = [];
  for (let i = 0; i < years.length; i++) {
    const y = years[i]!;
    // Money that appears between years outside the yearly totals.
    if (i > 0) value += y.begin - years[i - 1]!.end;
    const begin = value;
    const net = y.contributions - y.outflows;
    let months = 0;
    for (let m = 1; m <= 12; m++) {
      const [py, pm] = previousMonth(y.year, m);
      const prev = prices.get(monthKey(py, pm));
      const cur = prices.get(monthKey(y.year, m));
      if (prev === undefined || cur === undefined) break;
      months++;
      value = (value + net / 12) * (cur / prev);
    }
    // A partial year receives only the deposits of the months it covers.
    const netIn = (net * months) / 12;
    const gain = value - begin - netIn;
    const inShare = (y.contributions * months) / 12;
    const outShare = (y.outflows * months) / 12;
    out.push({
      year: y.year,
      begin: roundToCents(begin),
      end: roundToCents(value),
      months,
      returnPct:
        months === 0 ? null : computeReturn(begin, inShare, gain, outShare),
    });
    if (months < 12) break;
  }
  return out;
}

/** Your own money-weighted return for a year, as the Performance page computes it. */
export function yearlyReturn(y: YearlyResult): number | null {
  return computeReturn(y.begin, y.contributions, y.gain, y.outflows);
}

/**
 * Money-weighted annual return (IRR) for a run: start balance, monthly net
 * deposits, between-year jumps, end balance. Returns the cumulative return
 * instead when the run is shorter than a year. Null if it can't be solved.
 */
export function windowReturn(
  years: readonly YearlyResult[],
  endValue: number,
  totalMonths: number,
): { value: number; annualized: boolean } | null {
  if (years.length === 0 || totalMonths === 0) return null;
  // Cash flows from the investor's side: deposits negative, final value positive.
  const flows: { t: number; amount: number }[] = [
    { t: 0, amount: -years[0]!.begin },
  ];
  let t = 0;
  for (let i = 0; i < years.length && t < totalMonths; i++) {
    const y = years[i]!;
    if (i > 0) flows.push({ t, amount: -(y.begin - years[i - 1]!.end) });
    const net = y.contributions - y.outflows;
    for (let m = 0; m < 12 && t < totalMonths; m++, t++)
      flows.push({ t, amount: -net / 12 });
  }
  flows.push({ t: totalMonths, amount: endValue });
  const npv = (r: number) =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, f.t), 0);
  let lo = -0.99;
  let hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const monthly = (lo + hi) / 2;
  const annual = Math.pow(1 + monthly, 12) - 1;
  if (totalMonths < 12)
    return { value: Math.pow(1 + monthly, totalMonths) - 1, annualized: false };
  return { value: annual, annualized: true };
}
