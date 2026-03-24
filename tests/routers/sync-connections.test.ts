/**
 * Sync connections router integration tests.
 *
 * Tests connection status queries with empty DB. External API calls
 * (testConnection, fetchYnabBudgets, saveConnection) are excluded as
 * they require real API credentials.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";

// Mock budget-api to return "none" / null for all lookups
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  getApiConnection: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
  cacheClear: vi.fn().mockResolvedValue(undefined),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

describe("sync connections router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("getConnection", () => {
    it("returns no active API when nothing is configured", async () => {
      const result = await caller.sync.getConnection();
      expect(result.activeApi).toBe("none");
      expect(result.ynab.connected).toBe(false);
      expect(result.actual.connected).toBe(false);
    });

    it("returns null lastSyncedAt for unconfigured services", async () => {
      const result = await caller.sync.getConnection();
      expect(result.ynab.lastSyncedAt).toBeNull();
      expect(result.actual.lastSyncedAt).toBeNull();
    });
  });

  describe("getSyncStatus", () => {
    it("returns not connected when no API active", async () => {
      const result = await caller.sync.getSyncStatus();
      expect(result.service).toBeNull();
      expect(result.connected).toBe(false);
      expect(result.lastSynced).toBeNull();
    });
  });

  describe("deleteConnection", () => {
    it("succeeds even when no connection exists", async () => {
      const result = await caller.sync.deleteConnection({
        service: "ynab",
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe("testConnection", () => {
    it("returns failure when no connection configured", async () => {
      const result = await caller.sync.testConnection({
        service: "ynab",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No ynab connection configured");
    });
  });
});
