/** The stored-JSON tag's account-year categories, live and on restore: each
 *  account_performance row's parent_category becomes its performance
 *  account's, the one every read already uses. */
// No import from migration-converters.ts, which registers this one.
import { isRow, type Update } from "./converter-rows";

const ROWS = "account_performance";
const ACCOUNTS = "performance_accounts";

// A projection onto the account's category (the outcome is always the
// account's, whatever the row held), so a replay finds nothing to write.
// A row without its account is left; its read throws as it does today.
export const PERFORMANCE_CATEGORY_CONVERTER = {
  tables: [ACCOUNTS, ROWS],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const categoryOf = new Map<number, unknown>();
    for (const a of (tables[ACCOUNTS] ?? []).filter(isRow))
      categoryOf.set(Number(a["id"]), a["parent_category"]);
    const updates: Update[] = [];
    for (const row of (tables[ROWS] ?? []).filter(isRow)) {
      const category = categoryOf.get(Number(row["performance_account_id"]));
      if (typeof category !== "string" || category === row["parent_category"])
        continue;
      updates.push({
        table: ROWS,
        id: Number(row["id"]),
        set: { parent_category: category },
      });
    }
    return {
      updates,
      notes: [
        `${updates.length} account-year rows given their account's category`,
      ],
    };
  },
} as const;
