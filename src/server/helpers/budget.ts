/**
 * Budget expense computation helpers.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { roundToCents } from "@/lib/utils/math";
import { num } from "./transforms";
import type { Db } from "./transforms";
import { parseAppSettings } from "./settings";

/** 24 hours in milliseconds — max age for budget API cache before falling back to manual. */
export const BUDGET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Get effective cash balance.
 * When a budget API is active, sums on-budget cash-like account balances from cache.
 * Falls back to manual `current_cash` from app_settings when no API is active or cache is stale/empty.
 */
export async function getEffectiveCash(
  db: Db,
  settings: { key: string; value: unknown }[],
): Promise<{
  cash: number;
  source: "ynab" | "actual" | "manual";
  cacheAgeDays: number | null;
}> {
  const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
  const active = await getActiveBudgetApi(db);

  if (active !== "none") {
    type BudgetAccount = {
      onBudget: boolean;
      closed: boolean;
      type: string;
      balance: number;
    };
    const cached = await cacheGet<BudgetAccount[]>(
      db,
      active,
      "accounts",
      BUDGET_CACHE_MAX_AGE_MS,
    );
    if (cached) {
      const cashTypes = new Set(["checking", "savings", "cash"]);
      const cash = cached.data
        .filter((a) => a.onBudget && !a.closed && cashTypes.has(a.type))
        .reduce((sum, a) => sum + a.balance, 0);
      const cacheAgeDays = Math.floor(
        (Date.now() - cached.fetchedAt.getTime()) / 86_400_000,
      );
      return { cash, source: active, cacheAgeDays };
    }
  }

  // Fallback to manual cash
  const setting = parseAppSettings(settings);
  return {
    cash: setting("current_cash", 0),
    source: "manual",
    cacheAgeDays: null,
  };
}

/**
 * Effective other-assets total for current year.
 * When otherAssetItems exist (carry-forward to current year), uses their total;
 * otherwise falls back to app_settings['current_other_assets'].
 * This ensures API-synced asset values (which write to otherAssetItems) flow
 * into net worth, historical, and finalize-year calculations.
 */
export async function getEffectiveOtherAssets(
  db: Db,
  settings: { key: string; value: unknown }[],
): Promise<number> {
  const result = await getEffectiveOtherAssetsDetailed(db, settings);
  return result.total;
}

/** Returns individual other-asset items (carry-forward) plus total.
 *  Each item includes `sourceYear` — the year the value was last entered.
 *  When sourceYear < currentYear, the value is carried forward and may be stale.
 *  `id` is included so callers can check API sync mappings. */
export async function getEffectiveOtherAssetsDetailed(
  db: Db,
  settings: { key: string; value: unknown }[],
): Promise<{
  items: {
    id: number | null;
    name: string;
    value: number;
    sourceYear: number;
  }[];
  total: number;
}> {
  const currentYear = new Date().getFullYear();
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
      const val = num(latest.value);
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

/**
 * Compute annualized total for a specific budget column from an array of
 * budget items. Each item's `amounts` array holds monthly values per column.
 * Used for tier-mode profiles (pick one column, × 12).
 */
export function computeBudgetColumnTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
): number {
  const monthlyTotal = items.reduce(
    (sum, item) => sum + (item.amounts[columnIndex] ?? 0),
    0,
  );
  return roundToCents(monthlyTotal * 12);
}

/**
 * Compute annualized total for a weighted-months profile.
 * Each column's monthly total is multiplied by its month weight.
 * Annual = sum(column_monthly_total × column_months[col])
 */
export function computeWeightedBudgetTotal(
  items: { amounts: number[] }[],
  columnMonths: number[],
): number {
  let annual = 0;
  for (let col = 0; col < columnMonths.length; col++) {
    const monthlyTotal = items.reduce(
      (sum, item) => sum + (item.amounts[col] ?? 0),
      0,
    );
    annual += monthlyTotal * (columnMonths[col] ?? 0);
  }
  return roundToCents(annual);
}

/**
 * Compute the correct annual total for a profile, handling both modes:
 * - Weighted profiles (columnMonths set): weighted combination of all columns
 * - Tier profiles (columnMonths null): single column × 12
 */
export function computeBudgetAnnualTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
  columnMonths: number[] | null,
): number {
  if (columnMonths) return computeWeightedBudgetTotal(items, columnMonths);
  return computeBudgetColumnTotal(items, columnIndex);
}

export async function getAnnualExpensesFromBudget(db: Db): Promise<number> {
  const settings = await db.select().from(schema.appSettings);
  const settingsMap = new Map(
    settings.map((s: { key: string; value: unknown }) => [s.key, s.value]),
  );

  // Use the shared budget_active_column setting (same as budget page, savings page, dashboard)
  const columnSetting = settingsMap.get("budget_active_column");
  const column = typeof columnSetting === "number" ? columnSetting : 0;

  const profiles = await db
    .select()
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.isActive, true));
  const profile = profiles[0];

  if (!profile) return 0;

  const items = await db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.profileId, profile.id));

  return computeBudgetAnnualTotal(
    items,
    column,
    profile.columnMonths as number[] | null,
  );
}
