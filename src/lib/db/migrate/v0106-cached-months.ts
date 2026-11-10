/** The credentials tag's cached-months step: every cached budget month is
 *  harvested into savings history once, then purged, so the sync reads only
 *  the shape today's clients write. Rules: CACHED_MONTHS_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { asBool, isRow, jsonObject, type Row } from "./converter-rows";

const CACHE = "budget_api_cache";
const MONTHLY = "savings_monthly";
const GOALS = "savings_goals";
const LINKS = "savings_goal_category_links";
const SETTINGS = "app_settings";

/** The budget apps as this tag found them (config/budget-apps.ts), frozen
 *  here as keys: a replay never follows a later release's list. */
const SERVICES: Readonly<Record<string, true>> = { ynab: true, actual: true };
const MONTH_KEY = /^months\/(\d{4}-(?:0[1-9]|1[0-2])-01)$/;

/** The active budget app as getActiveBudgetApi read it: a known service
 *  in app_settings `active_budget_api` (JSON text on SQLite), else none. */
function activeService(settings: readonly Row[]): string | null {
  const row = settings.find((s) => s["key"] === "active_budget_api");
  let value: unknown = row?.["value"];
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      // Plain text: the value as it is.
    }
  return typeof value === "string" && Object.hasOwn(SERVICES, value)
    ? value
    : null;
}

/** Each category's balance by id, as readCachedMonthBalances read any
 *  shape: a category without a string id or a number balance is left out. */
function balances(data: unknown): Map<string, number> {
  const list = jsonObject(data)?.["categories"];
  const out = new Map<string, number>();
  if (!Array.isArray(list)) return out;
  for (const c of list)
    if (
      isRow(c) &&
      typeof c["id"] === "string" &&
      typeof c["balance"] === "number"
    )
      out.set(c["id"], c["balance"]);
  return out;
}

/** Sync's rule, frozen: the active goals with a primary link for the
 *  active service, each with its category id. */
function linkedGoals(
  tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  service: string,
) {
  const active = new Set(
    (tables[GOALS] ?? [])
      .filter(isRow)
      .filter((g) => asBool(g["is_active"]) === true)
      .map((g) => Number(g["id"])),
  );
  return (tables[LINKS] ?? [])
    .filter(isRow)
    .filter(
      (l) =>
        l["service"] === service &&
        l["role"] === "primary" &&
        active.has(Number(l["savings_goal_id"])),
    )
    .map((l) => ({
      goalId: Number(l["savings_goal_id"]),
      categoryId: String(l["category_id"]),
    }));
}

/** Insert-only, as the sync's harvest: a goal and month savings_monthly
 *  holds is skipped. A later squash replay harvests what the sync cached
 *  since, as the sync would, and drops it; the next sync re-caches the month. */
export const CACHED_MONTHS_CONVERTER = {
  tables: [CACHE, MONTHLY, GOALS, LINKS, SETTINGS],
  runs: "afterSql",
  rowCounts: { grows: [MONTHLY], shrinks: [CACHE] },
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const months = (tables[CACHE] ?? [])
      .filter(isRow)
      .filter(
        (r) =>
          typeof r["cache_key"] === "string" &&
          r["cache_key"].startsWith("months/"),
      );
    const service = activeService((tables[SETTINGS] ?? []).filter(isRow));
    const goals = service === null ? [] : linkedGoals(tables, service);
    const held = new Set(
      (tables[MONTHLY] ?? [])
        .filter(isRow)
        .map((r) => `${Number(r["goal_id"])}|${String(r["month_date"])}`),
    );
    const inserts: { table: string; row: Row }[] = [];
    let harvestedFrom = 0;
    for (const entry of months) {
      if (entry["service"] !== service) continue;
      const month = MONTH_KEY.exec(String(entry["cache_key"]))?.[1];
      if (month === undefined) continue;
      const byCategory = balances(entry["data"]);
      const before = inserts.length;
      for (const goal of goals) {
        const balance = byCategory.get(goal.categoryId);
        const pair = `${goal.goalId}|${month}`;
        if (balance === undefined || held.has(pair)) continue;
        held.add(pair);
        inserts.push({
          table: MONTHLY,
          row: {
            goal_id: goal.goalId,
            month_date: month,
            balance: String(balance),
            deposit_or_withdrawal: null,
            notes: null,
          },
        });
      }
      if (inserts.length > before) harvestedFrom++;
    }
    const deletes = months.map((r) => ({ table: CACHE, id: Number(r["id"]) }));
    return {
      updates: [],
      inserts,
      deletes,
      notes: [
        `${inserts.length} savings months harvested from ${harvestedFrom} cached budget months; ${months.length - harvestedFrom} more purged with nothing harvested`,
      ],
    };
  },
} as const;
