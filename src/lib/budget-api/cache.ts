// Cache read/write/invalidate helpers for budget API data.
// Uses the budget_api_cache table as a local cache of remote API state.

import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { BudgetApiService } from "./types";

type Db = typeof import("@/lib/db").db;

/** Read a cached value. Returns null if not found or expired. */
export async function cacheGet<T>(
  db: Db,
  service: BudgetApiService,
  key: string,
  maxAgeMs?: number,
): Promise<{
  data: T;
  serverKnowledge: number | null;
  fetchedAt: Date;
} | null> {
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

  if (maxAgeMs && row.fetchedAt) {
    const age = Date.now() - row.fetchedAt.getTime();
    if (age > maxAgeMs) return null;
  }

  return {
    data: row.data as T,
    serverKnowledge: row.serverKnowledge,
    fetchedAt: row.fetchedAt,
  };
}

/** Write a value to the cache (upsert by service + key). */
export async function cacheSet(
  db: Db,
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
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.budgetApiCache.service, schema.budgetApiCache.cacheKey],
      set: {
        data,
        serverKnowledge: serverKnowledge ?? null,
        fetchedAt: new Date(),
      },
    });
}

/** Remove a specific cache entry. */
export async function cacheDelete(
  db: Db,
  service: BudgetApiService,
  key: string,
): Promise<void> {
  await db
    .delete(schema.budgetApiCache)
    .where(
      and(
        eq(schema.budgetApiCache.service, service),
        eq(schema.budgetApiCache.cacheKey, key),
      ),
    );
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
