/**
 * Pure business logic for historical data temporal resolution.
 * No DB or I/O dependency.
 */
import { toNumber } from "@/lib/utils/numbers";
import { sumBy } from "@/lib/utils/math";

/** An other-asset item from the DB. */
type OtherAssetItem = {
  id?: number;
  name: string;
  year: number;
  value: string | null;
  note: string | null;
};

/**
 * Resolve the carry-forward value for a named asset at a given year.
 * Uses the most recent entry at-or-before the target year. Returns null if no entry or value is 0.
 */
export function resolveCarryForwardAssetValue(
  items: OtherAssetItem[],
  name: string,
  year: number,
): {
  id?: number;
  value: number;
  note: string | null;
  yearRecorded: number;
} | null {
  const entries = items.filter((a) => a.name === name && a.year <= year);
  if (entries.length === 0) return null;
  // Items are already sorted by year asc — take the last one
  const latest = entries[entries.length - 1]!;
  const val = toNumber(latest.value);
  if (val <= 0) return null;
  return {
    id: latest.id,
    value: val,
    note: latest.note,
    yearRecorded: latest.year,
  };
}

/**
 * Resolve all other assets for a given year using carry-forward logic.
 * Returns items with positive values and the total.
 */
export function resolveOtherAssetsForYear(
  allAssets: OtherAssetItem[],
  year: number,
): {
  items: { id?: number; name: string; value: number; note: string | null }[];
  total: number;
} {
  const uniqueNames = Array.from(new Set(allAssets.map((a) => a.name)));
  const items: {
    id?: number;
    name: string;
    value: number;
    note: string | null;
  }[] = [];
  for (const name of uniqueNames) {
    const resolved = resolveCarryForwardAssetValue(allAssets, name, year);
    if (resolved) {
      items.push({
        id: resolved.id,
        name,
        value: resolved.value,
        note: resolved.note,
      });
    }
  }
  return { items, total: sumBy(items, (i) => i.value) };
}

/**
 * Compute cumulative home improvement costs up to a given year.
 */
export function computeHomeImpCumulative(
  items: { year: number; cost: string | null }[],
  upToYear: number,
): number {
  return sumBy(
    items.filter((hi) => hi.year <= upToYear),
    (hi) => toNumber(hi.cost),
  );
}

/**
 * One year-end row's asset figures. A year with line items takes their
 * totals; a year without keeps the row's stored figure.
 */
export function resolveYearAssets(
  row: { year: number; homeImprovements: number; otherAssets: number },
  homeImprovements: {
    id: number;
    year: number;
    description: string;
    cost: string;
    note: string | null;
  }[],
  otherAssets: OtherAssetItem[],
) {
  const items = homeImprovements.filter((hi) => hi.year === row.year);
  const other = resolveOtherAssetsForYear(otherAssets, row.year);
  return {
    homeImprovements:
      items.length > 0
        ? computeHomeImpCumulative(homeImprovements, row.year)
        : row.homeImprovements,
    homeImprovementItems: items.map((i) => ({
      id: i.id,
      year: i.year,
      description: i.description,
      cost: toNumber(i.cost),
      note: i.note,
    })),
    otherAssets: other.items.length > 0 ? other.total : row.otherAssets,
    otherAssetItems: other.items,
  };
}
