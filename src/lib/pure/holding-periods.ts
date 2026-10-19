/**
 * Dated holding periods — "held these funds, in these shares, from … to …"
 * per tracked account.
 *
 * Observed periods are derived here from daily SimpleFIN holdings on read
 * (never stored — one source of truth): consecutive days holding the same
 * funds collapse into one period. Entered (user) and inferred periods are
 * stored (holding_periods) and validated here. Priority where they
 * overlap: observed → user → inferred.
 */
import { HOLDING_PERIODS } from "@/lib/config/benchmarks";
import { tradingDaysBetween } from "@/lib/pure/market-calendar";

export type PeriodBasis = "observed" | "user" | "inferred";

export type HoldingPeriod = {
  /** Stored periods only. */
  id: number | null;
  performanceAccountId: number;
  start: string;
  /** null = still held. */
  end: string | null;
  basis: PeriodBasis;
  /** securityId → share of the account (sums to 1). For an observed
   *  period, the shares on its first day — display only (they move with
   *  prices every day; the matched mix reads the daily observations). */
  weights: Record<number, number>;
};

/** One fund's value in an account on a day (latest-day rule already applied, 0-share rows dropped). */
export type DailyPosition = {
  performanceAccountId: number;
  day: string;
  securityId: number;
  value: number;
};

function weightsOf(
  positions: readonly DailyPosition[],
): Record<number, number> {
  const total = positions.reduce((s, p) => s + Math.max(0, p.value), 0);
  const w: Record<number, number> = {};
  if (total <= 0) return w;
  for (const p of positions)
    w[p.securityId] = (w[p.securityId] ?? 0) + Math.max(0, p.value) / total;
  return w;
}

/** Each account's fund weights per observed day (ascending) — what the
 *  matched mix reads in the observed window. */
export function dailyWeightsByAccount(
  positions: readonly DailyPosition[],
): Map<number, { day: string; weights: Record<number, number> }[]> {
  const byAccountDay = new Map<number, Map<string, DailyPosition[]>>();
  for (const p of positions) {
    const days = byAccountDay.get(p.performanceAccountId) ?? new Map();
    days.set(p.day, [...(days.get(p.day) ?? []), p]);
    byAccountDay.set(p.performanceAccountId, days);
  }
  return new Map(
    [...byAccountDay].map(([id, days]) => [
      id,
      [...days.keys()]
        .sort()
        .map((day) => ({ day, weights: weightsOf(days.get(day)!) }))
        .filter((d) => Object.keys(d.weights).length > 0),
    ]),
  );
}

function sameFunds(a: Record<number, number>, b: Record<number, number>) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b);
}

/**
 * Observed periods per account. A new period starts when the set of funds
 * changes or the daily data skips more trading days than allowed (shares
 * move with prices every day, so they never split a period). The last
 * period stays open (still held) only when it reaches the account's latest
 * feed day; a closed or unlinked feed's last period ends on its last day,
 * so it can't mask entered history forever.
 */
export function deriveObservedPeriods(
  positions: readonly DailyPosition[],
  /** Each account's latest day of holdings data from its feeds. */
  latestFeedDay: ReadonlyMap<number, string>,
): HoldingPeriod[] {
  const byAccountDay = new Map<number, Map<string, DailyPosition[]>>();
  for (const p of positions) {
    const days = byAccountDay.get(p.performanceAccountId) ?? new Map();
    days.set(p.day, [...(days.get(p.day) ?? []), p]);
    byAccountDay.set(p.performanceAccountId, days);
  }
  const out: HoldingPeriod[] = [];
  for (const [accountId, days] of byAccountDay) {
    const sorted = [...days.keys()].sort();
    let open: HoldingPeriod | null = null;
    let lastDay: string | null = null;
    for (const day of sorted) {
      const w = weightsOf(days.get(day)!);
      if (Object.keys(w).length === 0) continue;
      const gap =
        lastDay !== null &&
        tradingDaysBetween(lastDay, day) >
          HOLDING_PERIODS.observedMaxGapTradingDays + 1;
      if (open && (gap || !sameFunds(open.weights, w))) {
        open.end = lastDay;
        out.push(open);
        open = null;
      }
      if (!open)
        open = {
          id: null,
          performanceAccountId: accountId,
          start: day,
          end: null,
          basis: "observed",
          weights: w,
        };
      lastDay = day;
    }
    if (open) {
      if (lastDay !== latestFeedDay.get(accountId)) open.end = lastDay;
      out.push(open);
    }
  }
  return out;
}

export type PeriodProblem =
  | "weightsDontSum"
  | "badWeight"
  | "endBeforeStart"
  | "overlapsEntered"
  | "noFunds"
  | "duplicateFund";

/** Problems with an entered period, against the account's other periods
 *  of the same basis (an inferred proposal never blocks a user entry). */
export function validateHoldingPeriod(
  period: {
    id: number | null;
    start: string;
    end: string | null;
    weights: readonly { securityId: number; weight: number }[];
  },
  others: readonly { id: number | null; start: string; end: string | null }[],
): PeriodProblem[] {
  const problems: PeriodProblem[] = [];
  if (period.weights.length === 0) problems.push("noFunds");
  if (
    new Set(period.weights.map((w) => w.securityId)).size !==
    period.weights.length
  )
    problems.push("duplicateFund");
  if (period.weights.some((w) => !(w.weight > 0 && w.weight <= 1)))
    problems.push("badWeight");
  const sum = period.weights.reduce((s, w) => s + w.weight, 0);
  if (
    period.weights.length > 0 &&
    Math.abs(sum - 1) > HOLDING_PERIODS.weightSumTolerance
  )
    problems.push("weightsDontSum");
  if (period.end !== null && period.end < period.start)
    problems.push("endBeforeStart");
  const endOf = (e: string | null) => e ?? "9999-12-31";
  if (
    others.some(
      (o) =>
        o.id !== period.id &&
        o.start <= endOf(period.end) &&
        period.start <= endOf(o.end),
    )
  )
    problems.push("overlapsEntered");
  return problems;
}

/**
 * The period that applies to an account on a day, by priority: observed,
 * then user-entered, then inferred. null = not covered.
 */
export function periodOn(
  periods: readonly HoldingPeriod[],
  performanceAccountId: number,
  day: string,
): HoldingPeriod | null {
  const rank: Record<PeriodBasis, number> = {
    observed: 0,
    user: 1,
    inferred: 2,
  };
  return (
    periods
      .filter(
        (p) =>
          p.performanceAccountId === performanceAccountId &&
          p.start <= day &&
          (p.end === null || day <= p.end),
      )
      .sort((a, b) => rank[a.basis] - rank[b.basis])[0] ?? null
  );
}
