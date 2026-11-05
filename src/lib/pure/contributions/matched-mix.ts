/**
 * The matched mix — the household's own fund weights, month by month,
 * priced with a plain index fund per composition bucket
 * (BUCKET_INDEX_PROXIES). Built as a synthetic monthly price level that
 * goes through the same simulateIndex as every benchmark (one computation
 * path), so it replays the same deposits and withdrawals.
 *
 * Weights for a month: in the observed window the actual holdings on the
 * month's first observed day (shares drift with prices — the daily data
 * says where they really were); otherwise the entered period covering the
 * month's first day (constant weights, i.e. rebalanced monthly). Accounts
 * are weighted by their beginning-of-year balance. An account kept per part
 * (accountSplits — a joint IRA with one feed per person) is built per part
 * the same way and the parts combined by their snapshot shares
 * (partSharesOn); when every part with money has daily data that month,
 * that is the account's pooled daily mix. A month counts only
 * when every account with money that year is covered and the share with a
 * known mix and an index proxy reaches HOLDINGS_MIN_COVERAGE; the rest is
 * reported as excluded. Fund mixes are today's facts — a target-date fund
 * glides, so older years are approximate (the UI says so).
 */
import { BUCKET_INDEX_PROXIES } from "@/lib/config/benchmarks";
import {
  COMPOSITION_BUCKET_VALUES,
  type CompositionBucket,
} from "@/lib/config/enum-values";
import { HOLDINGS_MIN_COVERAGE } from "@/lib/config/milestones";
import {
  monthKey,
  previousMonth,
  runBenchmark,
  type MonthlyPrices,
  type YearlyResult,
} from "@/lib/pure/benchmark-yearly";
import { portfolioBuckets, type EffectiveFacts } from "@/lib/pure/fund-facts";
import { sumBy } from "@/lib/utils/math";
import {
  holderKey,
  partSharesOn,
  periodOn,
  type HoldingPeriod,
  type SnapshotParts,
} from "@/lib/pure/holding-periods";

export type MatchedMixInput = {
  /** Calendar years to build (ascending). */
  years: readonly number[];
  /** Year → account → beginning balance (the account's weight that year). */
  accountValues: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** Entered (user / inferred) periods. */
  periods: readonly HoldingPeriod[];
  /** Account → daily fund weights from observations, ascending by day. */
  observedDaily: ReadonlyMap<
    number,
    readonly { day: string; weights: Record<number, number> }[]
  >;
  /** Accounts kept per part (accountSplits); absent = whole account. */
  splits: ReadonlyMap<number, { conflict: boolean }>;
  /** holderKey → daily fund weights of that part (split accounts). */
  observedDailyByPart: ReadonlyMap<
    string,
    readonly { day: string; weights: Record<number, number> }[]
  >;
  /** Split account → its snapshots' part amounts, ascending by date. */
  partSnapshots: ReadonlyMap<number, readonly SnapshotParts[]>;
  facts: ReadonlyMap<number, EffectiveFacts>;
  /** Month-end prices per bucket's proxy (null = not priced). */
  proxyPrices: Readonly<Record<CompositionBucket, MonthlyPrices | null>>;
};

type MatchedMixLevels = {
  /** Synthetic month-end level, starting at 100 the month before the first covered month. */
  prices: Map<string, number>;
  firstMonth: string | null;
  /** Largest share of a covered month left out (no mix, `other`, no proxy). */
  excludedShare: number;
};

type Observed = Map<
  number | string,
  Map<string, { day: string; weights: Record<number, number> }>
>;

/** account (or holderKey) → "YYYY-MM" → the month's first observed day and its weights. */
function firstObservedByMonth(
  observedDaily: ReadonlyMap<
    number | string,
    readonly { day: string; weights: Record<number, number> }[]
  >,
): Observed {
  const out: Observed = new Map();
  for (const [accountId, days] of observedDaily) {
    const byMonth = new Map<
      string,
      { day: string; weights: Record<number, number> }
    >();
    for (const d of days) {
      const key = d.day.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, d);
    }
    out.set(accountId, byMonth);
  }
  return out;
}

function fundWeightsFor(
  input: MatchedMixInput,
  observed: Observed,
  observedByPart: Observed,
  accountId: number,
  year: number,
  month: number,
): Record<number, number> | null {
  const key = monthKey(year, month);
  const firstDay = `${key}-01`;
  const firstObserved = observed.get(accountId)?.get(key);
  const split = input.splits.get(accountId);
  if (!split) {
    if (firstObserved) return firstObserved.weights;
    const p = periodOn(input.periods, accountId, null, firstDay);
    return p ? p.weights : null;
  }
  // Part feeds and a whole-account feed at once: not guessed.
  if (split.conflict) return null;
  const shares = partSharesOn(
    input.partSnapshots.get(accountId) ?? [],
    firstDay,
  );
  if (shares.size === 0) return null;
  const partWeights = [...shares].map(([part, share]) => {
    const seen = observedByPart.get(holderKey(accountId, part))?.get(key);
    return {
      share,
      seen,
      weights:
        seen?.weights ??
        periodOn(input.periods, accountId, part, firstDay)?.weights,
    };
  });
  // Every part with money first reported on the account's first observed
  // day of the month: that day's pooled holdings are the account's real
  // mix. (A part that starts later in the month isn't in that day.)
  if (
    firstObserved &&
    partWeights.every((x) => x.seen?.day === firstObserved.day)
  )
    return firstObserved.weights;
  if (partWeights.some((x) => !x.weights)) return null;
  const out: Record<number, number> = {};
  for (const { share, weights } of partWeights)
    for (const [id, w] of Object.entries(weights!))
      out[Number(id)] = (out[Number(id)] ?? 0) + share * w;
  return out;
}

/** Bucket weights for a month (renormalized over priced buckets), or null when not covered. */
function monthBuckets(
  input: MatchedMixInput,
  observed: Observed,
  observedByPart: Observed,
  year: number,
  month: number,
): {
  weights: Partial<Record<CompositionBucket, number>>;
  excluded: number;
} | null {
  const values = input.accountValues.get(year);
  if (!values) return null;
  const total = sumBy([...values.values()], (v) => Math.max(0, v));
  if (total <= 0) return null;
  const holdings: { value: number; facts: EffectiveFacts }[] = [];
  for (const [accountId, value] of values) {
    if (value <= 0) continue;
    const w = fundWeightsFor(
      input,
      observed,
      observedByPart,
      accountId,
      year,
      month,
    );
    if (!w) return null;
    for (const [id, share] of Object.entries(w)) {
      const facts = input.facts.get(Number(id));
      const v = (value / total) * share;
      // A fund with no facts adds nothing priced — it's in the excluded share.
      if (facts) holdings.push({ value: v, facts });
    }
  }
  const { buckets } = portfolioBuckets(holdings);
  let priced = 0;
  const weights: Partial<Record<CompositionBucket, number>> = {};
  for (const b of COMPOSITION_BUCKET_VALUES)
    if (BUCKET_INDEX_PROXIES[b] && input.proxyPrices[b] && buckets[b] > 0) {
      weights[b] = buckets[b];
      priced += buckets[b];
    }
  const excluded = 1 - priced;
  if (priced <= 0 || priced < HOLDINGS_MIN_COVERAGE) return null;
  for (const b of Object.keys(weights) as CompositionBucket[])
    weights[b] = weights[b]! / priced;
  return { weights, excluded };
}

export function matchedMixLevels(input: MatchedMixInput): MatchedMixLevels {
  const prices = new Map<string, number>();
  let level = 100;
  let firstMonth: string | null = null;
  let excludedShare = 0;
  const observed = firstObservedByMonth(input.observedDaily);
  const observedByPart = firstObservedByMonth(input.observedDailyByPart);
  for (const year of input.years)
    for (let month = 1; month <= 12; month++) {
      const [py, pm] = previousMonth(year, month);
      const mix = monthBuckets(input, observed, observedByPart, year, month);
      let ret: number | null = mix ? 0 : null;
      if (mix)
        for (const [b, w] of Object.entries(mix.weights) as [
          CompositionBucket,
          number,
        ][]) {
          const series = input.proxyPrices[b]!;
          const cur = series.get(monthKey(year, month));
          const prev = series.get(monthKey(py, pm));
          if (cur === undefined || prev === undefined) {
            ret = null;
            break;
          }
          ret! += w * (cur / prev - 1);
        }
      if (ret === null) {
        // Only one unbroken covered run, from its first month.
        if (firstMonth !== null) return { prices, firstMonth, excludedShare };
        continue;
      }
      if (firstMonth === null) {
        firstMonth = monthKey(year, month);
        prices.set(monthKey(py, pm), level);
      }
      level *= 1 + ret;
      prices.set(monthKey(year, month), level);
      excludedShare = Math.max(excludedShare, mix!.excluded);
    }
  return { prices, firstMonth, excludedShare };
}

/** Year → account → beginning balance: each account's weight in a year. */
export function accountValuesByYear(
  rows: readonly {
    year: number;
    performanceAccountId: number;
    beginningBalance: number;
  }[],
): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const r of rows) {
    const m = out.get(r.year) ?? new Map<number, number>();
    m.set(
      r.performanceAccountId,
      (m.get(r.performanceAccountId) ?? 0) + r.beginningBalance,
    );
    out.set(r.year, m);
  }
  return out;
}

/** "Up to N% of the money is left out" — for the entry's description. */
export function matchedMixDescription(excludedShare: number): string {
  const pct = Math.round(excludedShare * 100);
  return `Your own funds' mix over time (from your holding history), priced with a plain index fund for each class — what the same choices would have earned in index funds. Fund mixes are as of their latest facts, so years long ago are approximate for funds that change their mix (target-date funds).${pct > 0 ? ` Up to ${pct}% of the money (funds with no known mix, or "other") is left out.` : ""} Shown from the first full year your history covers.`;
}

/**
 * The matched-mix levels through the same simulateIndex as every benchmark.
 * simulateIndex starts at a year's January, so the run begins at the first
 * year whose previous December is priced.
 */
export function matchedMixRun(
  years: readonly YearlyResult[],
  levels: MatchedMixLevels,
) {
  const covered = years.filter((y) =>
    levels.prices.has(monthKey(y.year - 1, 12)),
  );
  return runBenchmark(covered, levels.prices);
}
