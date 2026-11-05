import {
  isPullMapping,
  mappingsWithTypedIds,
} from "@/lib/pure/sync/account-mapping";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { parseAppSettings } from "@/lib/pure/household/app-settings";
import type { BudgetApiService, ActiveBudgetApi } from "@/lib/budget-api/types";
import type { Db } from "@/lib/db";

/** No TTL — cached YNAB data is kept until the user manually triggers a resync. */
const BUDGET_CACHE_MAX_AGE_MS = undefined;

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
