/** The money tag's budget amounts, live and on restore: an item's `amounts`
 *  gets one number per column of its profile, a missing or null column as
 *  the 0 the budget read for it. Rules: BUDGET_AMOUNTS_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { isRow, jsonArray, type Update } from "./converter-rows";

/** The amounts padded with 0 to `columns` and each null as 0; anything else
 *  stays (a longer array keeps its extra elements). A projection. */
function padded(amounts: readonly unknown[], columns: number) {
  const out = amounts.map((a) => (a === null ? 0 : a));
  while (out.length < columns) out.push(0);
  return out;
}

// Gated on structure (an array shorter than its profile's column list, or
// holding a null); the writers pad on add and splice on remove, so a replay
// finds nothing. Never truncates, never reads an amount's magnitude.
export const BUDGET_AMOUNTS_CONVERTER = {
  tables: ["budget_profiles", "budget_items"],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const columns = new Map<unknown, number>();
    for (const p of (tables["budget_profiles"] ?? []).filter(isRow)) {
      const labels = jsonArray(p["column_labels"]);
      if (labels) columns.set(p["id"], labels.length);
    }
    const updates: Update[] = [];
    for (const item of (tables["budget_items"] ?? []).filter(isRow)) {
      const count = columns.get(item["profile_id"]);
      const amounts = jsonArray(item["amounts"]);
      if (
        count === undefined ||
        !amounts ||
        (amounts.length >= count && !amounts.includes(null))
      )
        continue;
      updates.push({
        table: "budget_items",
        id: Number(item["id"]),
        set: { amounts: padded(amounts, count) },
      });
    }
    return {
      updates,
      notes: [`${updates.length} budget items' amounts given every column`],
    };
  },
} as const;
