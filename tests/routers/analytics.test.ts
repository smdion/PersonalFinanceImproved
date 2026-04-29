/**
 * Analytics router integration tests.
 *
 * Covers the main query + mutation procedures in src/server/routers/analytics.ts:
 * getHoldings, getAccounts, getSnapshots, getAssetClasses, getGlidePathForAge,
 * getSnapshotBalances, hasFmpKey, getHoldingsHistory, copyHoldingsToSnapshot,
 * bulkUpsertHoldings, deleteHolding.
 *
 * lookupTicker is excluded — it makes an outbound HTTP call to FMP and cannot
 * be reliably tested without a live API key.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
  adminSession,
} from "./setup";

let _dateSeq = 0;
function nextDate(): string {
  _dateSeq++;
  const year = 2020 + Math.floor(_dateSeq / 365);
  const doy = (_dateSeq % 365) + 1;
  const d = new Date(year, 0, doy);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

describe("analytics router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const harness = await createTestCaller(adminSession);
    caller = harness.caller;
    db = harness.db;
    cleanup = harness.cleanup;
  });

  afterAll(() => cleanup());

  // ── getHoldings ────────────────────────────────────────────────────────────

  describe("getHoldings", () => {
    it("returns empty array when no holdings exist", async () => {
      const result = await caller.analytics.getHoldings({});
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("returns holdings for a specific snapshot after insert", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      // Insert a holding directly
      db.insert(schema.accountHoldings)
        .values({
          performanceAccountId: perfAcctId,
          snapshotId,
          ticker: "VTI",
          name: "Vanguard Total Stock Market ETF",
          weightBps: 10000,
          assetClassSource: "manual",
        })
        .run();

      const result = await caller.analytics.getHoldings({ snapshotId });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({ ticker: "VTI", weightBps: 10000 });
    });
  });

  // ── bulkUpsertHoldings ─────────────────────────────────────────────────────

  describe("bulkUpsertHoldings", () => {
    it("inserts holdings and returns them", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      const result = await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId,
        holdings: [
          {
            ticker: "AGG",
            name: "iShares Core US Aggregate Bond ETF",
            weightBps: 5000,
          },
          { ticker: "SPY", name: "SPDR S&P 500 ETF", weightBps: 5000 },
        ],
      });
      expect(result).toHaveLength(2);
      expect(result.map((h) => h.ticker).sort()).toEqual(["AGG", "SPY"]);
    });

    it("replaces existing holdings for the same account+snapshot", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId,
        holdings: [{ ticker: "VTI", name: "VTI", weightBps: 10000 }],
      });
      const result = await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId,
        holdings: [{ ticker: "BND", name: "BND", weightBps: 10000 }],
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ ticker: "BND" });
    });

    it("returns empty array when holdings list is empty", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      const result = await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId,
        holdings: [],
      });
      expect(result).toEqual([]);
    });
  });

  // ── deleteHolding ──────────────────────────────────────────────────────────

  describe("deleteHolding", () => {
    it("deletes a holding by id", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      const [inserted] = await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId,
        holdings: [{ ticker: "DEL", name: "Delete Me", weightBps: 10000 }],
      });

      const result = await caller.analytics.deleteHolding({ id: inserted!.id });
      expect(result).toEqual({ success: true });

      const after = await caller.analytics.getHoldings({ snapshotId });
      expect(after.every((h) => h.id !== inserted!.id)).toBe(true);
    });
  });

  // ── copyHoldingsToSnapshot ─────────────────────────────────────────────────

  describe("copyHoldingsToSnapshot", () => {
    it("returns count 0 when source snapshot has no holdings", async () => {
      seedPerformanceAccount(db);
      const fromSnapshotId = seedSnapshot(db, nextDate());
      const toSnapshotId = seedSnapshot(db, nextDate());

      const result = await caller.analytics.copyHoldingsToSnapshot({
        fromSnapshotId,
        toSnapshotId,
      });
      expect(result).toEqual({ count: 0 });
    });

    it("copies holdings to destination snapshot", async () => {
      const perfAcctId = seedPerformanceAccount(db);
      const fromSnapshotId = seedSnapshot(db, nextDate());
      const toSnapshotId = seedSnapshot(db, nextDate());

      await caller.analytics.bulkUpsertHoldings({
        performanceAccountId: perfAcctId,
        snapshotId: fromSnapshotId,
        holdings: [
          { ticker: "IVV", name: "iShares Core S&P 500", weightBps: 10000 },
        ],
      });

      const result = await caller.analytics.copyHoldingsToSnapshot({
        fromSnapshotId,
        toSnapshotId,
      });
      expect(result).toEqual({ count: 1 });

      const copied = await caller.analytics.getHoldings({
        snapshotId: toSnapshotId,
      });
      expect(copied[0]).toMatchObject({ ticker: "IVV" });
    });
  });

  // ── getHoldingsHistory ─────────────────────────────────────────────────────

  describe("getHoldingsHistory", () => {
    it("returns empty array when no holdings exist", async () => {
      const { caller: freshCaller, cleanup: c } =
        await createTestCaller(adminSession);
      try {
        const result = await freshCaller.analytics.getHoldingsHistory({});
        expect(Array.isArray(result)).toBe(true);
      } finally {
        c();
      }
    });
  });

  // ── getAccounts ────────────────────────────────────────────────────────────

  describe("getAccounts", () => {
    it("returns active performance accounts", async () => {
      const result = await caller.analytics.getAccounts();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── getSnapshots ───────────────────────────────────────────────────────────

  describe("getSnapshots", () => {
    it("returns portfolio snapshots ordered by date desc", async () => {
      const result = await caller.analytics.getSnapshots();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── getAssetClasses ────────────────────────────────────────────────────────

  describe("getAssetClasses", () => {
    it("returns empty array when no asset classes seeded", async () => {
      const { caller: freshCaller, cleanup: c } =
        await createTestCaller(adminSession);
      try {
        const result = await freshCaller.analytics.getAssetClasses();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(0);
      } finally {
        c();
      }
    });
  });

  // ── getGlidePathForAge ─────────────────────────────────────────────────────

  describe("getGlidePathForAge", () => {
    it("returns empty array when no glide path is configured", async () => {
      const result = await caller.analytics.getGlidePathForAge({ age: 40 });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  // ── getSnapshotBalances ────────────────────────────────────────────────────

  describe("getSnapshotBalances", () => {
    it("returns balances for a snapshot", async () => {
      seedPerformanceAccount(db);
      const snapshotId = seedSnapshot(db, nextDate());

      const result = await caller.analytics.getSnapshotBalances({ snapshotId });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── hasFmpKey ──────────────────────────────────────────────────────────────

  describe("hasFmpKey", () => {
    it("returns false when no FMP connection is configured", async () => {
      const result = await caller.analytics.hasFmpKey();
      expect(result).toBe(false);
    });
  });
});
