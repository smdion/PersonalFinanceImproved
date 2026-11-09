import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import type { Db } from "@/lib/db";

/**
 * Current-year other-assets total: the carried-forward otherAssetItems (where API-synced values
 * land) when any exist, else app_settings['current_other_assets'].
 */
export async function getEffectiveOtherAssets(
  db: Db,
  settings: { key: string; value: unknown }[],
  asOfDate: Date,
): Promise<number> {
  const result = await getEffectiveOtherAssetsDetailed(db, settings, asOfDate);
  return result.total;
}

/** Other-asset items (carried forward) plus total. `sourceYear` is the year the value was last
 *  entered (older than the current year = may be stale); `id` lets callers check API sync
 *  mappings. `asOfDate` is the request's date or a resolved one (a year-end snapshot's). */
export async function getEffectiveOtherAssetsDetailed(
  db: Db,
  settings: { key: string; value: unknown }[],
  asOfDate: Date,
): Promise<{
  items: {
    id: number | null;
    name: string;
    value: number;
    sourceYear: number;
  }[];
  total: number;
}> {
  const currentYear = asOfDate.getFullYear();
  const allItems = await db.select().from(schema.otherAssetItems);

  // Carry-forward: for each unique name, find the latest entry where year <= currentYear
  const uniqueNames = Array.from(new Set(allItems.map((a) => a.name)));
  const items: {
    id: number | null;
    name: string;
    value: number;
    sourceYear: number;
  }[] = [];
  for (const name of uniqueNames) {
    const entries = allItems
      .filter((a) => a.name === name && a.year <= currentYear)
      .sort((a, b) => a.year - b.year);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1]!;
      const val = toNumber(latest.value);
      if (val > 0) {
        items.push({
          id: latest.id,
          name,
          value: val,
          sourceYear: latest.year,
        });
      }
    }
  }

  if (items.length > 0) {
    return { items, total: items.reduce((s, i) => s + i.value, 0) };
  }

  // Fallback to manual scalar
  const setting = parseAppSettings(settings);
  const fallback = setting("current_other_assets", 0);
  return {
    items:
      fallback > 0
        ? [
            {
              id: null,
              name: "Other Assets",
              value: fallback,
              sourceYear: currentYear,
            },
          ]
        : [],
    total: fallback,
  };
}
