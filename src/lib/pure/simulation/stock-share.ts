/**
 * The stock share of the portfolio at each age, from an allocation glide
 * path — what VPW sizes its percentage by. An asset class counts as stocks
 * when any of its composition buckets is a stock bucket (the same rule the
 * holdings view uses; a class's buckets carry no weights to split it by).
 * Ages between glide-path points interpolate like the Simulation does.
 */
import {
  interpolateAllocations,
  type GlidePathEntry,
} from "@/lib/pure/simulation/random";
import {
  isStockBucket,
  type CompositionBucket,
} from "@/lib/config/enum-values";

/** glide_path_allocations rows → the glide path, by age (the shape the
 *  Simulation's buildSimulationInputs builds from the same table). */
export function glidePathFromRows(
  rows: readonly {
    age: number;
    assetClassId: number;
    allocation: string | number;
  }[],
): GlidePathEntry[] {
  const byAge = new Map<number, Record<number, number>>();
  for (const r of rows) {
    const at = byAge.get(r.age) ?? {};
    at[r.assetClassId] = Number(r.allocation);
    byAge.set(r.age, at);
  }
  return [...byAge.entries()]
    .sort(([a], [b]) => a - b)
    .map(([age, allocations]) => ({ age, allocations }));
}

/** Which asset classes are mapped to composition buckets at all, and
 *  which of those hold a stock bucket. A class with no mapping is unknown —
 *  never counted as bonds. */
export function classifyAssetClasses(
  buckets: readonly { assetClassId: number; bucket: CompositionBucket }[],
): { mapped: Set<number>; stocks: Set<number> } {
  return {
    mapped: new Set(buckets.map((b) => b.assetClassId)),
    stocks: new Set(
      buckets.filter((b) => isStockBucket(b.bucket)).map((b) => b.assetClassId),
    ),
  };
}

/** Age → stock share (0–1) of the mapped part of the glide path, for every
 *  age from `fromAge` to `toAge` that has any; null when no age does (no
 *  glide path, or no class mapped) — the strategy then uses its own. */
export function stockShareByAge(
  glidePath: GlidePathEntry[],
  classes: { mapped: ReadonlySet<number>; stocks: ReadonlySet<number> },
  fromAge: number,
  toAge: number,
): Record<number, number> | null {
  const out: Record<number, number> = {};
  let any = false;
  if (glidePath.length === 0) return null;
  for (let age = Math.floor(fromAge); age <= Math.ceil(toAge); age++) {
    const allocation = interpolateAllocations(glidePath, age);
    let mapped = 0;
    let stocks = 0;
    for (const [id, weight] of Object.entries(allocation)) {
      if (!classes.mapped.has(Number(id))) continue;
      mapped += weight;
      if (classes.stocks.has(Number(id))) stocks += weight;
    }
    if (mapped <= 0) continue;
    out[age] = stocks / mapped;
    any = true;
  }
  return any ? out : null;
}

/** Projection Health's stock allocation: the percent (one decimal) of stocks in
 *  the Default preset's glide path at `currentAge`, by the share VPW uses.
 *  Null without a glide path or a mapped class (no glide-path warning). */
export function computeCurrentStockAllocationPercent(
  data: {
    defaultPreset: { glidePath: GlidePathEntry[] };
    classBucketRows: readonly {
      assetClassId: number;
      bucket: CompositionBucket;
    }[];
  },
  currentAge: number,
): number | null {
  const share = stockShareByAge(
    data.defaultPreset.glidePath,
    classifyAssetClasses(data.classBucketRows),
    currentAge,
    currentAge,
  )?.[Math.floor(currentAge)];
  return share === undefined ? null : Math.round(share * 1000) / 10;
}
