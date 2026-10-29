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
import { roundToCents, sumBy } from "@/lib/utils/math";

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

type IndexYear = {
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

/** One account-year of performance, as numbers (the router converts). */
export type PerformanceYearRow = {
  year: number;
  beginningBalance: number;
  totalContributions: number;
  rollovers: number;
  distributions: number;
  fees: number;
  yearlyGainLoss: number;
  endingBalance: number;
};

/** The household's yearly results (all accounts summed), oldest first.
 *  Rollovers count as money in; distributions and fees as money out. */
export function yearlyResultsFrom(
  rows: readonly PerformanceYearRow[],
): YearlyResult[] {
  const byYear = new Map<number, YearlyResult>();
  for (const r of rows) {
    const y = byYear.get(r.year) ?? {
      year: r.year,
      begin: 0,
      contributions: 0,
      outflows: 0,
      gain: 0,
      end: 0,
    };
    y.begin += r.beginningBalance;
    y.contributions += r.totalContributions + r.rollovers;
    y.outflows += r.distributions + r.fees;
    y.gain += r.yearlyGainLoss;
    y.end += r.endingBalance;
    byYear.set(r.year, y);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/**
 * Where the default window starts: after any leading placeholder years —
 * records with an effectively zero return (e.g. flat estimates entered for
 * early years). They stay selectable; they just don't start the comparison.
 */
export function firstRealYear(years: readonly YearlyResult[]): number | null {
  const real = years.find((y) => Math.abs(yearlyReturn(y) ?? 0) >= 0.001);
  return real?.year ?? years[0]?.year ?? null;
}

/** One benchmark's run over `years` and its window return — the one path
 *  every benchmark (and the matched mix) goes through. */
export function runBenchmark(
  years: readonly YearlyResult[],
  prices: MonthlyPrices | null,
): {
  available: boolean;
  years: IndexYear[];
  window: ReturnType<typeof windowReturn>;
} {
  const run = prices && years.length > 0 ? simulateIndex(years, prices) : null;
  const months = sumBy(run ?? [], (r) => r.months);
  const last = run?.at(-1);
  return {
    available: !!run && run.length > 0,
    years: run ?? [],
    window: run && last ? windowReturn(years, last.end, months) : null,
  };
}

/**
 * Months your own window return covers: the most any benchmark priced (so
 * you and the indexes cover the same months), else the calendar months of
 * `years` — the current year only through today.
 */
export function yourWindowMonths(
  years: readonly YearlyResult[],
  benchmarkYears: readonly (readonly IndexYear[])[],
  today: Date,
): number {
  const priced = Math.max(
    0,
    ...benchmarkYears.map((ys) => sumBy(ys, (r) => r.months)),
  );
  if (priced > 0) return priced;
  const full =
    years.length * 12 -
    (years.at(-1)?.year === today.getFullYear() ? 12 - today.getMonth() : 0);
  return Math.max(full, 0);
}
