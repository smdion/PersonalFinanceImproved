/**
 * projection-cache helper — hashEngineInput canonicalization, and the
 * read/write/evict cache lifecycle against a real (SQLite) DB.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  hashEngineInput,
  readProjectionCache,
  writeProjectionCache,
  generateSeed,
  PROJECTION_CACHE_ENGINE_VERSION,
} from "@/server/helpers/projection-cache";
import { createTestDb, type TestDbContext } from "./db-harness";
import * as schema from "@/lib/db/schema-sqlite";
import { eq } from "drizzle-orm";

describe("hashEngineInput", () => {
  it("is stable for the same input", () => {
    const input = { a: 1, b: "x", c: [1, 2, 3] };
    expect(hashEngineInput("deterministic", input)).toBe(
      hashEngineInput("deterministic", input),
    );
  });

  it("is order-independent for object keys", () => {
    const a = hashEngineInput("deterministic", { a: 1, b: 2 });
    const b = hashEngineInput("deterministic", { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("differs for different kinds, same input", () => {
    const input = { a: 1 };
    expect(hashEngineInput("deterministic", input)).not.toBe(
      hashEngineInput("monteCarlo", input),
    );
  });

  it("differs when any field changes", () => {
    const a = hashEngineInput("deterministic", { salary: 100000 });
    const b = hashEngineInput("deterministic", { salary: 100001 });
    expect(a).not.toBe(b);
  });

  it("truncates Date fields to day granularity", () => {
    const a = hashEngineInput("deterministic", {
      asOfDate: new Date("2026-08-23T01:00:00.000Z"),
    });
    const b = hashEngineInput("deterministic", {
      asOfDate: new Date("2026-08-23T23:59:59.999Z"),
    });
    expect(a).toBe(b);
  });

  it("does not collapse different days", () => {
    const a = hashEngineInput("deterministic", {
      asOfDate: new Date("2026-08-23T01:00:00.000Z"),
    });
    const b = hashEngineInput("deterministic", {
      asOfDate: new Date("2026-08-24T01:00:00.000Z"),
    });
    expect(a).not.toBe(b);
  });
});

describe("projection cache read/write lifecycle", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("returns null on a miss", async () => {
    const hit = await readProjectionCache(ctx.rawDb, "nonexistent-hash");
    expect(hit).toBeNull();
  });

  it("returns the written result and seed on a hit", async () => {
    const hash = hashEngineInput("deterministic", { salary: 123 });
    await writeProjectionCache(ctx.rawDb, hash, { totalBalance: 500000 }, null);

    const hit = await readProjectionCache<{ totalBalance: number }>(
      ctx.rawDb,
      hash,
    );
    expect(hit).not.toBeNull();
    expect(hit!.result.totalBalance).toBe(500000);
    expect(hit!.seed).toBeNull();
  });

  it("persists a seed and returns the same one on subsequent hits", async () => {
    const hash = hashEngineInput("monteCarlo", { numTrials: 1000 });
    const seed = generateSeed();
    await writeProjectionCache(ctx.rawDb, hash, { successRate: 0.9 }, seed);

    const hit1 = await readProjectionCache(ctx.rawDb, hash);
    const hit2 = await readProjectionCache(ctx.rawDb, hash);
    expect(hit1!.seed).toBe(seed);
    expect(hit2!.seed).toBe(seed);
  });

  it("a second write to the same hash replaces the row (upsert), not duplicates it", async () => {
    const hash = hashEngineInput("deterministic", { salary: 999 });
    await writeProjectionCache(ctx.rawDb, hash, { v: 1 }, null);
    await writeProjectionCache(ctx.rawDb, hash, { v: 2 }, null);

    const rows = ctx.db
      .select()
      .from(schema.projectionCache)
      .where(eq(schema.projectionCache.inputHash, hash))
      .all();
    expect(rows).toHaveLength(1);
    expect((rows[0]!.result as { v: number }).v).toBe(2);
  });

  it("treats an expired row as a miss and deletes it", async () => {
    const hash = hashEngineInput("deterministic", { salary: 55555 });
    // Write directly with an already-past expiresAt — writeProjectionCache
    // always sets a future TTL, so this bypasses it to simulate expiry.
    ctx.db
      .insert(schema.projectionCache)
      .values({
        inputHash: hash,
        seed: null,
        result: { v: 1 },
        expiresAt: new Date(Date.now() - 1000),
        engineVersion: PROJECTION_CACHE_ENGINE_VERSION,
      })
      .run();

    const hit = await readProjectionCache(ctx.rawDb, hash);
    expect(hit).toBeNull();

    const remaining = ctx.db
      .select()
      .from(schema.projectionCache)
      .where(eq(schema.projectionCache.inputHash, hash))
      .all();
    expect(remaining).toHaveLength(0);
  });

  it("does not hit across different engineVersion rows", async () => {
    const hash = hashEngineInput("deterministic", { salary: 77777 });
    ctx.db
      .insert(schema.projectionCache)
      .values({
        inputHash: hash,
        seed: null,
        result: { v: 1 },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        engineVersion: PROJECTION_CACHE_ENGINE_VERSION + 999,
      })
      .run();

    const hit = await readProjectionCache(ctx.rawDb, hash);
    expect(hit).toBeNull();
  });
});

describe("generateSeed", () => {
  it("returns a non-negative integer", () => {
    const seed = generateSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it("is not the same value every call (sanity, not a randomness proof)", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => generateSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});
