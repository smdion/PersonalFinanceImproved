/**
 * Shared API balance resolution — eliminates duplicated apiBalanceMap patterns.
 *
 * Two helpers:
 *   getApiAccountBalanceMap  — async, fetches cached accounts and builds Map
 *   resolveAccountBalance    — pure, picks API or snapshot balance for one account
 */

import type { Db } from "./transforms";
import type { BudgetAccount, BudgetApiService } from "@/lib/budget-api";
import { cacheGet } from "@/lib/budget-api";
import type { AccountMapping } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// 1. Build Map<remoteAccountId, balance> from cached budget accounts
// ---------------------------------------------------------------------------

/** Fetch cached BudgetAccount[] and build a remoteId → balance map.  Returns null when the cache is empty. */
export async function getApiAccountBalanceMap(
  db: Db,
  service: BudgetApiService,
): Promise<Map<string, number> | null> {
  const cached = await cacheGet<BudgetAccount[]>(db, service, "accounts");
  if (!cached) return null;
  return getApiAccountBalanceMapFromAccounts(cached.data);
}

/** Pure variant — accepts an already-fetched BudgetAccount[] (e.g. from a live API call). */
export function getApiAccountBalanceMapFromAccounts(
  accounts: BudgetAccount[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of accounts) map.set(a.id, a.balance);
  return map;
}

// ---------------------------------------------------------------------------
// 2. Resolve a single account's balance: API vs snapshot
// ---------------------------------------------------------------------------

export type ResolvedBalance = {
  balance: number;
  source: "api" | "snapshot";
};

/** Pick API balance when the account is mapped with pull/both direction; otherwise keep snapshot. */
export function resolveAccountBalance(
  snapshotBalance: number,
  mapping: AccountMapping | undefined,
  apiBalanceMap: Map<string, number> | null,
): ResolvedBalance {
  if (
    mapping &&
    mapping.performanceAccountId != null &&
    (mapping.syncDirection === "pull" || mapping.syncDirection === "both") &&
    apiBalanceMap
  ) {
    const apiBalance = apiBalanceMap.get(mapping.remoteAccountId);
    if (apiBalance !== undefined) {
      return { balance: apiBalance, source: "api" };
    }
  }
  return { balance: snapshotBalance, source: "snapshot" };
}
