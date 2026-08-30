/**
 * Server-side cache for retirement projection results — the deterministic
 * engine result, Monte Carlo, and Coast FIRE MC. See schema-pg.ts's
 * `projectionCache` doc comment for why this is its own table rather than
 * reusing `budgetApiCache`.
 *
 * Design:
 *  - Cache key = sha256 of a canonicalized JSON form of the EXACT object
 *    passed to the pure calculator (calculateProjection/calculateMonteCarlo),
 *    not the raw tRPC input — the router resolves contributionProfileId/
 *    salaryProfileId/etc. into live DB state (salaries, portfolio,
 *    contribution accounts, IRS limits) that isn't otherwise captured, and
 *    hashing only the tRPC input would silently serve stale cross-device
 *    results after e.g. a salary edit. Canonicalization sorts object keys
 *    (defense in depth — the source objects already have stable insertion
 *    order) and truncates any Date to day granularity (asOfDate is threaded
 *    through per RULES.md's Time Resolution convention and would otherwise
 *    make every request a miss).
 *  - `seed` lives WITH the cached row, not as a separately-persisted
 *    setting: a cache MISS generates a fresh random seed and stores it
 *    alongside the result; a HIT returns the seed that was already used —
 *    honestly reproducible ("this exact run really would produce this
 *    answer"), not a frozen snapshot of randomness masquerading as
 *    determinism. "Re-run simulation" forces a miss (see forceRefresh
 *    param), which mints a new seed.
 *  - `engineVersion` (PROJECTION_CACHE_ENGINE_VERSION below) is folded into
 *    the uniqueness constraint so bumping it after an engine-logic change
 *    invalidates every existing row without a manual cache-clear.
 *  - Eviction is opportunistic, not cron-driven: every write deletes
 *    expired rows and, if the table is still over the size cap, the
 *    oldest-by-lastReadAt rows — cheap enough to run inline given how
 *    infrequently writes happen relative to reads.
 */

import { createHash } from "crypto";
import { and, eq, lt, asc, sql, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "./transforms";
import { log } from "@/lib/logger";

/** Bump when a change to the engine's computation logic could change
 *  output for the same inputs — invalidates all existing cache rows. */
export const PROJECTION_CACHE_ENGINE_VERSION = 10;

const TTL_MS = 36 * 60 * 60 * 1000; // 36h
const MAX_ROWS = 500;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    // Day granularity — finer precision doesn't change engine output and
    // would otherwise make every request a miss (asOfDate is resolved
    // fresh, to the millisecond, on every request).
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Hash the exact engine input for one of the cacheable computations. `kind`
 * namespaces the procedures so the same underlying engine input never
 * collides across them — their results are shaped completely differently.
 */
export function hashEngineInput(
  kind:
    | "deterministic"
    | "monteCarlo"
    | "coastFireMc"
    | "coastFireProbe"
    | "strategyComparison",
  input: unknown,
): string {
  const canonical = canonicalize({ kind, input });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ProjectionCacheHit<TResult> {
  result: TResult;
  seed: number | null;
  computedAt: Date;
}

/** Returns null on a miss (no row, expired, or wrong engine version). */
export async function readProjectionCache<TResult = unknown>(
  db: Db,
  inputHash: string,
): Promise<ProjectionCacheHit<TResult> | null> {
  const [row] = await db
    .select()
    .from(schema.projectionCache)
    .where(
      and(
        eq(schema.projectionCache.inputHash, inputHash),
        eq(
          schema.projectionCache.engineVersion,
          PROJECTION_CACHE_ENGINE_VERSION,
        ),
      ),
    );
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .delete(schema.projectionCache)
      .where(eq(schema.projectionCache.id, row.id));
    return null;
  }

  // Best-effort freshness touch — an eviction/read-order signal, not load-
  // bearing for correctness, so a failure here must never fail the read.
  db.update(schema.projectionCache)
    .set({ lastReadAt: new Date() })
    .where(eq(schema.projectionCache.id, row.id))
    .catch((err) =>
      log("warn", "projection_cache_touch_failed", { error: String(err) }),
    );

  return {
    result: row.result as TResult,
    seed: row.seed,
    computedAt: row.computedAt,
  };
}

/** Generates a fresh seed, writes the row, and opportunistically evicts.
 *  Returns the seed used (callers that need a seed, e.g. Monte Carlo,
 *  should generate + pass one; deterministic results pass null). */
export async function writeProjectionCache(
  db: Db,
  inputHash: string,
  result: unknown,
  seed: number | null,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  await db
    .insert(schema.projectionCache)
    .values({
      inputHash,
      seed,
      result,
      computedAt: now,
      expiresAt,
      lastReadAt: now,
      engineVersion: PROJECTION_CACHE_ENGINE_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        schema.projectionCache.inputHash,
        schema.projectionCache.engineVersion,
      ],
      set: { seed, result, computedAt: now, expiresAt, lastReadAt: now },
    });

  // Fire-and-forget, same as readProjectionCache's lastReadAt touch below —
  // eviction is opportunistic housekeeping with no bearing on THIS
  // request's own correctness, so it must not add its DB round trips to
  // the response latency of every cache-miss request (exactly the request
  // that already paid for the expensive computation this cache exists to
  // avoid repeating).
  evictProjectionCache(db).catch((err) =>
    log("warn", "projection_cache_evict_failed", { error: String(err) }),
  );
}

/** A fresh, non-cryptographic seed — Monte Carlo doesn't need
 *  cryptographic randomness, just a value that's a real int32 fit for the
 *  engine's PRNG and stable once stored. */
export function generateSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Unconditionally wipes every cached deterministic/MC/Coast-FIRE row —
 *  the operational escape hatch for "I need every projection recomputed
 *  right now" without bumping `PROJECTION_CACHE_ENGINE_VERSION` and
 *  redeploying (user request, 2026-08-28: bumping the version has been
 *  the only way to force this all session, which needs a code change +
 *  deploy for what's really a one-off cache-bust). No `user_id`/household
 *  scoping column exists on this table (single-tenant app), so this
 *  clears the whole table by design — the next request per input simply
 *  recomputes and re-populates it. Returns the row count deleted, for a
 *  confirmation toast. */
export async function clearProjectionCache(db: Db): Promise<number> {
  const deleted = await db
    .delete(schema.projectionCache)
    .returning({ id: schema.projectionCache.id });
  return deleted.length;
}

async function evictProjectionCache(db: Db): Promise<void> {
  await db
    .delete(schema.projectionCache)
    .where(lt(schema.projectionCache.expiresAt, new Date()));

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectionCache);
  const over = (countRow?.count ?? 0) - MAX_ROWS;
  if (over <= 0) return;

  const oldest = await db
    .select({ id: schema.projectionCache.id })
    .from(schema.projectionCache)
    .orderBy(asc(schema.projectionCache.lastReadAt))
    .limit(over);
  if (oldest.length === 0) return;
  await db.delete(schema.projectionCache).where(
    inArray(
      schema.projectionCache.id,
      oldest.map((row) => row.id),
    ),
  );
}
