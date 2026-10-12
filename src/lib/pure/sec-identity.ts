/**
 * Resolving any fund to its SEC identity, and suggesting a registered
 * stand-in for funds SEC doesn't list (e.g. workplace-plan collective
 * trusts). Pure; generic over every fund in SEC's registry.
 */
import { normalizeSeriesName } from "./sec-composition";

export type RegistryRow = {
  cik: string;
  seriesId: string;
  seriesName: string;
  classId: string;
  ticker: string | null;
};

export type RegistryIndex = {
  /** symbol → series/class. */
  byTicker: Map<string, { seriesId: string; classId: string }>;
  /** normalised series name → series id (only names that are unique). */
  seriesByName: Map<string, string>;
  /** series id → its name and first share class (used for stand-ins). */
  series: Map<string, { name: string; classIds: string[] }>;
};

export function buildRegistryIndex(
  rows: readonly RegistryRow[],
  fundTickers: ReadonlyMap<string, { seriesId: string; classId: string }>,
): RegistryIndex {
  const byTicker = new Map(fundTickers);
  const nameCount = new Map<string, Set<string>>();
  const series = new Map<string, { name: string; classIds: string[] }>();
  for (const r of rows) {
    if (r.ticker && !byTicker.has(r.ticker))
      byTicker.set(r.ticker, { seriesId: r.seriesId, classId: r.classId });
    const s = series.get(r.seriesId) ?? { name: r.seriesName, classIds: [] };
    s.classIds.push(r.classId);
    series.set(r.seriesId, s);
    const n = normalizeSeriesName(r.seriesName);
    const ids = nameCount.get(n) ?? new Set<string>();
    ids.add(r.seriesId);
    nameCount.set(n, ids);
  }
  const seriesByName = new Map<string, string>();
  for (const [n, ids] of nameCount)
    if (ids.size === 1) seriesByName.set(n, [...ids][0]!);
  return { byTicker, seriesByName, series };
}

/** Words that say nothing about what a fund holds. */
const NOISE = new Set([
  "fund",
  "funds",
  "trust",
  "the",
  "inc",
  "class",
  "shares",
  "share",
  "portfolio",
  "series",
  "nl",
  "cit",
  "collective",
  "investment",
]);

function tokens(name: string): Set<string> {
  return new Set(
    normalizeSeriesName(name)
      .split(" ")
      .filter((t) => t.length > 1 && !NOISE.has(t)),
  );
}

/**
 * The registered series whose name best matches `name` (e.g. a plan-only
 * "… Index 2060 NL Fund H" → the registered "… Index 2060 Fund"). Every
 * number in the name (target years, index numbers) must match; at least
 * `minScore` of the words must overlap. A suggestion only — the household
 * confirms it.
 */
export function suggestStandIn(
  name: string,
  index: RegistryIndex,
  minScore = 0.6,
): { seriesId: string; name: string; score: number } | null {
  const want = tokens(name);
  if (want.size === 0) return null;
  const numbers = [...want].filter((t) => /^\d+$/.test(t));
  let best: { seriesId: string; name: string; score: number } | null = null;
  for (const [seriesId, s] of index.series) {
    const have = tokens(s.name);
    if (numbers.some((n) => !have.has(n))) continue;
    let common = 0;
    for (const t of want) if (have.has(t)) common++;
    const score = common / Math.max(want.size, have.size);
    if (score >= minScore && (!best || score > best.score))
      best = { seriesId, name: s.name, score };
  }
  return best;
}
