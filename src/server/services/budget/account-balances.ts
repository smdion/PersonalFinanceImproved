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
 * Sum the CACHED balances of accounts mapped to "cash" or "creditCard" for the service (as
 * magnitudes; a card's debt is positive). `null` when there are no such mappings, so the
 * caller falls back to its own detection. Actual has no account type, hence manual mapping.
 */
async function sumMappedAccountBalances(
  db: Db,
  service: BudgetApiService,
  localId: "cash" | "creditCard",
): Promise<{
  total: number;
  cacheAgeDays: number;
  /** Mapped accounts the budget app doesn't list (closed or deleted):
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
 * Effective cash: the active service's "Cash" mappings if any, else YNAB's on-budget
 * cash-type accounts from cache, else manual `current_cash` from app_settings.
 */
export async function getEffectiveCash(
  db: Db,
  settings: { key: string; value: unknown }[],
  /** Pass when the caller already resolved it, to skip re-querying; omit to resolve here. */
  activeBudgetApi?: ActiveBudgetApi,
): Promise<{
  cash: number;
  source: BudgetApiService | "manual";
  cacheAgeDays: number | null;
  /** Mapped cash accounts the budget app doesn't list. */
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
 * Credit-card debt from "Credit Card" mappings, added on top of manual
 * `current_other_liabilities`. No auto-detection: neither YNAB nor Actual marks a card
 * reliably, so it's nonzero only once an account is mapped.
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
