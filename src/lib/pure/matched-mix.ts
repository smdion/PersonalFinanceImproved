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
 * are weighted by their beginning-of-year balance. A month counts only
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
  type MonthlyPrices,
} from "@/lib/pure/benchmark-yearly";
import { portfolioBuckets, type EffectiveFacts } from "@/lib/pure/fund-facts";
import { periodOn, type HoldingPeriod } from "@/lib/pure/holding-periods";

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
  facts: ReadonlyMap<number, EffectiveFacts>;
  /** Month-end prices per bucket's proxy (null = not priced). */
  proxyPrices: Readonly<Record<CompositionBucket, MonthlyPrices | null>>;
};

export type MatchedMixLevels = {
  /** Synthetic month-end level, starting at 100 the month before the first covered month. */
  prices: Map<string, number>;
  firstMonth: string | null;
  /** Largest share of a covered month left out (no mix, `other`, no proxy). */
  excludedShare: number;
};

function fundWeightsFor(
  input: MatchedMixInput,
  accountId: number,
  year: number,
  month: number,
): Record<number, number> | null {
  const key = monthKey(year, month);
  const firstObserved = input.observedDaily
    .get(accountId)
    ?.find((d) => d.day.startsWith(key));
  if (firstObserved) return firstObserved.weights;
  const p = periodOn(input.periods, accountId, `${key}-01`);
  return p ? p.weights : null;
}

/** Bucket weights for a month (renormalized over priced buckets), or null when not covered. */
function monthBuckets(
  input: MatchedMixInput,
  year: number,
  month: number,
): {
  weights: Partial<Record<CompositionBucket, number>>;
  excluded: number;
} | null {
  const values = input.accountValues.get(year);
  if (!values) return null;
  const total = [...values.values()].reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return null;
  const holdings: { value: number; facts: EffectiveFacts }[] = [];
  for (const [accountId, value] of values) {
    if (value <= 0) continue;
    const w = fundWeightsFor(input, accountId, year, month);
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
  for (const year of input.years)
    for (let month = 1; month <= 12; month++) {
      const [py, pm] = previousMonth(year, month);
      const mix = monthBuckets(input, year, month);
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
