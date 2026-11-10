/**
 * Server-side cache of projection results (deterministic, simulation, Coast FIRE), keyed by a hash
 * of the exact calculator input (day-granular dates) plus the engine-code hash; a miss stores a
 * fresh seed with its result. Eviction runs on each write (expired rows, then oldest over the cap).
 */

import { createHash } from "crypto";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { and, eq, lt, asc, sql, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import type { Db } from "@/lib/db";
import { countRows } from "@/lib/db/compat";
import { ENGINE_HASH } from "@/lib/generated/engine-hash";
import { writeStamp } from "@/lib/utils/clock";

/** The version cached rows are read and written under: a hash of the code
 *  the cached projections run (scripts/engine-hash.ts). */
export const PROJECTION_CACHE_ENGINE_VERSION = ENGINE_HASH;

const TTL_MS = 36 * 60 * 60 * 1000; // 36h
const MAX_ROWS = 500;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    // Local day: finer precision would make every request a miss, and the
    // engine reads `asOfDate` in local time, so a UTC day would key an evening
    // request on tomorrow.
    return calendarDateOf(value);
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

interface ProjectionCacheHit<TResult> {
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
  if (row.expiresAt.getTime() < writeStamp().getTime()) {
    await db
      .delete(schema.projectionCache)
      .where(eq(schema.projectionCache.id, row.id));
    return null;
  }

  // Best-effort freshness touch — an eviction/read-order signal, not load-
  // bearing for correctness, so a failure here must never fail the read.
  db.update(schema.projectionCache)
    .set({ lastReadAt: writeStamp() })
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
  const now = writeStamp();
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

  // Fire-and-forget: eviction is housekeeping, so it must not add DB round
  // trips to a cache-miss response.
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

/** Wipes every cached row (no per-user scoping: single-tenant), so every
 *  projection recomputes without an engine change. Returns the count
 *  deleted, for a confirmation toast. */
export async function clearProjectionCache(db: Db): Promise<number> {
  const deleted = await db
    .delete(schema.projectionCache)
    .returning({ id: schema.projectionCache.id });
  return deleted.length;
}

async function evictProjectionCache(db: Db): Promise<void> {
  await db
    .delete(schema.projectionCache)
    .where(lt(schema.projectionCache.expiresAt, writeStamp()));

  const countAll = db.select({ count: sql<number>`count(*)` });
  const over =
    countRows(await countAll.from(schema.projectionCache)) - MAX_ROWS;
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
