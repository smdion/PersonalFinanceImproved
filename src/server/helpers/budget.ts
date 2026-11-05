/**
 * Budget expense computation helpers.
 */
import {
  isPullMapping,
  mappingsWithTypedIds,
} from "@/lib/pure/sync/account-mapping";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import type { ActiveBudgetApi, BudgetApiService } from "@/lib/budget-api/types";
import { SK_BUDGET_ACTIVE_COLUMN } from "@/lib/constants/settings-keys";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import type { Db } from "@/lib/db";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";

/** No TTL — cached YNAB data is kept until the user manually triggers a resync. */
const BUDGET_CACHE_MAX_AGE_MS = undefined;

/**
 * The active-profile predicate, for callers that already have every profile
 * loaded in memory (e.g. the retirement engine payload builder, which fetches
 * `allBudgetProfiles` once for several purposes) and would otherwise
 * duplicate `getActiveBudgetProfile`'s `isActive` lookup inline.
 */
export function pickActiveBudgetProfile<T extends { isActive: boolean }>(
  profiles: T[],
): T | undefined {
  return profiles.find((p) => p.isActive);
}

/**
 * The active budget profile — the only place that should query
 * `budget_profiles.is_active = true`. Returns undefined if none is active
 * (e.g. a crash mid-`setActiveProfile` before that mutation's transaction
 * fix, or before any profile has ever been created).
 */
export async function getActiveBudgetProfile(
  db: Db,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.isActive, true));
  return pickActiveBudgetProfile(rows);
}

/**
 * Resolve "the profile a mutation should target" — explicit `profileId` when
 * given (a client editing a profile it is viewing but hasn't made active),
 * else the active profile. The single place profile item/column mutations
 * (createItem, addColumn, removeColumn, renameColumn, updateColumnMonths,
 * reorderCategory)
 * should resolve their target profile — a bare `getActiveBudgetProfile(db)`
 * in one of those procedures silently redirects an edit made while viewing a
 * non-active profile onto the active one instead.
 */
export async function resolveTargetBudgetProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  if (profileId) {
    const rows = await db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.id, profileId));
    return rows[0];
  }
  return getActiveBudgetProfile(db);
}

/**
 * Sum the CACHED balances of every account manually mapped to a fixed
 * pseudo-account (`localId` "cash" or "creditCard") for the given service —
 * see AccountMapping's docblock (schema-pg.ts). Returns `null` when the
 * service has no such mappings at all, so callers can fall back to their
 * own auto-detection instead of reporting a real $0.
 *
 * Manual mapping exists because Actual's API has no account "type" field
 * at all (the plain `/accounts` endpoint
 * returns only id/name/offbudget/closed, and a raw query against the
 * underlying `accounts` table itself has no `type` column either), so
 * there's no way to auto-detect "this is a checking account" the way
 * YNAB's account type lets `getEffectiveCash` do below. `Math.abs` on each
 * matched balance — a credit card mapping's balance is typically negative
 * (money owed); this returns its magnitude as a debt figure, matching how
 * apply-pull-mapping.ts already treats a mapped mortgage loan balance.
 */
async function sumMappedAccountBalances(
  db: Db,
  service: BudgetApiService,
  localId: "cash" | "creditCard",
): Promise<{
  total: number;
  cacheAgeDays: number;
  /** Mapped accounts the budget app no longer lists (closed or deleted):
   *  counted as nothing, and said so. */
  missing: number;
} | null> {
  const { cacheGet } = await import("@/lib/budget-api");
  const [conn] = await db
    .select({ accountMappings: schema.apiConnections.accountMappings })
    .from(schema.apiConnections)
    .where(eq(schema.apiConnections.service, service));
  const all = (conn?.accountMappings ?? []).filter(isPullMapping);
  // A remote also pulled into a debt or loan balance counts there, not
  // here (mappings saved before one-pull-per-account was enforced).
  const pulledElsewhere = new Set(
    mappingsWithTypedIds(all)
      .filter(
        (m) =>
          m.debtId != null ||
          (m.loanId != null && m.loanMapType === "loanBalance"),
      )
      .map((m) => m.remoteAccountId),
  );
  const mapped = all.filter(
    (m) => m.localId === localId && !pulledElsewhere.has(m.remoteAccountId),
  );
  if (mapped.length === 0) return null;

  type BudgetAccount = { id: string; balance: number };
  const cached = await cacheGet<BudgetAccount[]>(
    db,
    service,
    "accounts",
    BUDGET_CACHE_MAX_AGE_MS,
  );
  if (!cached) return null;
  const byId = new Map(cached.data.map((a) => [a.id, a.balance]));
  // A card's balance is what's owed, whichever sign the budget app uses;
  // cash keeps its sign — an overdrawn checking account takes from cash.
  const amount = (balance: number) =>
    localId === "creditCard" ? Math.abs(balance) : balance;
  return {
    total: mapped.reduce(
      (sum, m) => sum + amount(byId.get(m.remoteAccountId) ?? 0),
      0,
    ),
    missing: mapped.filter((m) => !byId.has(m.remoteAccountId)).length,
    cacheAgeDays: Math.floor(
      (Date.now() - cached.fetchedAt.getTime()) / 86_400_000,
    ),
  };
}

/**
 * Get effective cash balance.
 * When the active service has explicit "Cash" account mappings (see
 * sumMappedAccountBalances), sums those. Otherwise, for a budget API with a
 * real account-type field (YNAB), falls back to auto-detecting on-budget
 * checking/savings/cash accounts from cache. Falls back further to manual
 * `current_cash` from app_settings when no API is active, the cache is
 * stale/empty, or auto-detection finds nothing (e.g. Actual, which has no
 * account-type field to auto-detect from at all).
 */
export async function getEffectiveCash(
  db: Db,
  settings: { key: string; value: unknown }[],
  /** Pass this when the caller already resolved it (e.g. alongside a
   *  sibling getEffectiveCreditCardDebt call in the same procedure) —
   *  avoids re-querying apiConnections/cached balances for a value that
   *  can't have changed mid-request. Omit to resolve it here as before. */
  activeBudgetApi?: ActiveBudgetApi,
): Promise<{
  cash: number;
  source: BudgetApiService | "manual";
  cacheAgeDays: number | null;
  /** Mapped cash accounts the budget app no longer lists. */
  missingAccounts: number;
}> {
  const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
  const active = activeBudgetApi ?? (await getActiveBudgetApi(db));

  if (active !== "none") {
    const mappedCash = await sumMappedAccountBalances(db, active, "cash");
    if (mappedCash !== null) {
      return {
        cash: mappedCash.total,
        source: active,
        cacheAgeDays: mappedCash.cacheAgeDays,
        missingAccounts: mappedCash.missing,
      };
    }

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
    const cashTypes = new Set(["checking", "savings", "cash"]);
    const detected = cached?.data.filter(
      (a) => a.onBudget && !a.closed && cashTypes.has(a.type),
    );
    // Nothing detected (no cash-type account) falls through to the manual
    // figure — never $0 from the API.
    if (cached && detected && detected.length > 0) {
      const cash = detected.reduce((sum, a) => sum + a.balance, 0);
      const cacheAgeDays = Math.floor(
        (Date.now() - cached.fetchedAt.getTime()) / 86_400_000,
      );
      return { cash, source: active, cacheAgeDays, missingAccounts: 0 };
    }
  }

  // Fallback to manual cash
  const setting = parseAppSettings(settings);
  return {
    cash: setting("current_cash", 0),
    source: "manual",
    cacheAgeDays: null,
    missingAccounts: 0,
  };
}

/**
 * Effective credit-card debt from explicit "Credit Card" account mappings
 * (see sumMappedAccountBalances) — additive on top of the household's
 * manual `current_other_liabilities` figure, not a replacement for it,
 * since that setting may legitimately hold other debts too. Unlike
 * getEffectiveCash there's no auto-detection fallback for either service:
 * neither YNAB nor Actual's account list distinguishes a credit card from
 * any other on-budget account well enough to guess safely, so this only
 * ever returns a nonzero figure once the household has mapped at least one
 * account.
 */
export async function getEffectiveCreditCardDebt(
  db: Db,
  /** See getEffectiveCash's matching param. */
  activeBudgetApi?: ActiveBudgetApi,
): Promise<number> {
  const { getActiveBudgetApi } = await import("@/lib/budget-api");
  const active = activeBudgetApi ?? (await getActiveBudgetApi(db));
  if (active === "none") return 0;
  return (await sumMappedAccountBalances(db, active, "creditCard"))?.total ?? 0;
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
  asOfDate: Date = new Date(),
): Promise<number> {
  const result = await getEffectiveOtherAssetsDetailed(db, settings, asOfDate);
  return result.total;
}

/** Returns individual other-asset items (carry-forward) plus total.
 *  Each item includes `sourceYear` — the year the value was last entered.
 *  When sourceYear < currentYear, the value is carried forward and may be stale.
 *  `id` is included so callers can check API sync mappings.
 *  `asOfDate` defaults to now; pass it explicitly when the caller already has
 *  a resolved date (e.g. a year-end snapshot) to avoid a fresh `new Date()`. */
export async function getEffectiveOtherAssetsDetailed(
  db: Db,
  settings: { key: string; value: unknown }[],
  asOfDate: Date = new Date(),
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

/**
 * Optional override of which budget profile/column to read — lets a caller ask
 * "what would annual expenses be under profile X, column Y" instead of always
 * reading the globally-active profile + `budget_active_column` setting.
 */
export type BudgetTargeting = {
  budgetProfileId?: number | null;
  budgetColumn?: number | null;
};

export async function getAnnualExpensesFromBudget(
  db: Db,
  targeting?: BudgetTargeting,
): Promise<number> {
  const settings = await db.select().from(schema.appSettings);
  const settingsMap = new Map(
    settings.map((s: { key: string; value: unknown }) => [s.key, s.value]),
  );

  // Use the shared budget_active_column setting (same as budget page, savings page, dashboard)
  const columnSetting = settingsMap.get(SK_BUDGET_ACTIVE_COLUMN);
  const column =
    targeting?.budgetColumn ??
    (typeof columnSetting === "number" ? columnSetting : 0);

  const profile = await resolveTargetBudgetProfile(
    db,
    targeting?.budgetProfileId,
  );

  if (!profile) return 0;

  const items = await db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.profileId, profile.id));

  const resolvedItems = await resolveLinkedBudgetItemAmounts(
    db,
    items,
    (profile.columnLabels as string[] | null)?.length ?? 0,
    await resolveProfileSelection({ db }),
  );

  return computeBudgetAnnualTotal(
    resolvedItems,
    column,
    profile.columnMonths as number[] | null,
  );
}
