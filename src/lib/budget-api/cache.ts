// Cache read/write/invalidate helpers for budget API data.
// Uses the budget_api_cache table as a local cache of remote API state.

import "server-only";
import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { readStoredValue } from "@/lib/db/stored-setting";
import type {
  BudgetAccount,
  BudgetApiService,
  BudgetCategoryGroup,
  BudgetMonthDetail,
  BudgetTransaction,
} from "./types";
import { cachedShapeFor, type CacheKey } from "./cache-shapes";
import type { BudgetAPIClient } from "./interface";
import { currentMonthKey } from "@/lib/utils/date-keys";
import type { Db, DbOrTx } from "@/lib/db";
import { writeStamp } from "@/lib/utils/clock";

type Cached<T> = {
  data: T;
  serverKnowledge: number | null;
  fetchedAt: Date;
};

/** Read a cached value, checked against its key's shape (a refused one is
 *  logged once per key and read as stored). Null if not found or expired. */
export function cacheGet(
  db: Db,
  service: BudgetApiService,
  key: "accounts",
  maxAgeMs?: number,
): Promise<Cached<BudgetAccount[]> | null>;
export function cacheGet(
  db: Db,
  service: BudgetApiService,
  key: "categories",
  maxAgeMs?: number,
): Promise<Cached<BudgetCategoryGroup[]> | null>;
export function cacheGet(
  db: Db,
  service: BudgetApiService,
  key: "transactions",
  maxAgeMs?: number,
): Promise<Cached<BudgetTransaction[]> | null>;
export function cacheGet(
  db: Db,
  service: BudgetApiService,
  key: `months/${string}`,
  maxAgeMs?: number,
): Promise<Cached<BudgetMonthDetail> | null>;
export async function cacheGet(
  db: Db,
  service: BudgetApiService,
  key: CacheKey,
  maxAgeMs?: number,
): Promise<Cached<unknown> | null> {
  const rows = await db
    .select()
    .from(schema.budgetApiCache)
    .where(
      and(
        eq(schema.budgetApiCache.service, service),
        eq(schema.budgetApiCache.cacheKey, key),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (maxAgeMs) {
    const age = writeStamp().getTime() - row.fetchedAt.getTime();
    if (age > maxAgeMs) return null;
  }

  return {
    data: readStoredValue(
      `budget_api_cache.${key} (${service})`,
      row.data,
      cachedShapeFor(key),
    ),
    serverKnowledge: row.serverKnowledge,
    fetchedAt: row.fetchedAt,
  };
}

/** Write a value to the cache (upsert by service + key). */
export async function cacheSet(
  db: DbOrTx,
  service: BudgetApiService,
  key: string,
  data: unknown,
  serverKnowledge?: number,
): Promise<void> {
  await db
    .insert(schema.budgetApiCache)
    .values({
      service,
      cacheKey: key,
      data,
      serverKnowledge: serverKnowledge ?? null,
      fetchedAt: writeStamp(),
    })
    .onConflictDoUpdate({
      target: [schema.budgetApiCache.service, schema.budgetApiCache.cacheKey],
      set: {
        data,
        serverKnowledge: serverKnowledge ?? null,
        fetchedAt: writeStamp(),
      },
    });
}

/** Remove all cache entries for a service. */
export async function cacheClear(
  db: Db,
  service: BudgetApiService,
): Promise<void> {
  await db
    .delete(schema.budgetApiCache)
    .where(eq(schema.budgetApiCache.service, service));
}

/** Re-fetch categories + current-month detail into budget_api_cache after a
 *  push, which writes only to the remote API, so previews read fresh data.
 *  Lighter than syncAll: a push only changes category goal data. */
export async function refreshCategoryCache(
  { db, scope }: { db: Db; scope: { asOf: Date } },
  service: BudgetApiService,
  client: BudgetAPIClient,
): Promise<void> {
  const currentMonth = currentMonthKey(scope.asOf);
  const [categories, monthDetail] = await Promise.all([
    client.getCategories(scope.asOf),
    client.getMonthDetail(currentMonth),
  ]);
  // Together: categories and the month detail are read as one picture.
  await db.transaction(async (tx) => {
    await cacheSet(tx, service, "categories", categories);
    await cacheSet(tx, service, `months/${currentMonth}`, monthDetail);
  });
}
