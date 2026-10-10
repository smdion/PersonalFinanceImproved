/**
 * Tiingo router integration tests — key validation before save, encrypted
 * storage, status never leaking the key, and sync-permission enforcement.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestCaller, createViewerSessionWithPermissions } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { BudgetApiError } from "@/lib/budget-api/errors";

const testApiKey = vi.fn();
vi.mock("@/lib/tiingo/client", () => ({
  testApiKey: (key: string) => testApiKey(key),
}));

describe("tiingo router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  const storedRow = () =>
    db
      .select()
      .from(sqliteSchema.apiConnections)
      .where(eq(sqliteSchema.apiConnections.service, "tiingo"))
      .get();

  it("reports not connected when no key is stored", async () => {
    expect(await caller.tiingo.getStatus()).toEqual({
      connected: false,
      lastSyncedAt: null,
    });
  });

  it("testConnection reports not configured without a stored key", async () => {
    const result = await caller.tiingo.testConnection();
    expect(result.success).toBe(false);
  });

  it("does not save a key that Tiingo rejects", async () => {
    testApiKey.mockRejectedValueOnce(
      new BudgetApiError("Authentication failed (403)", "auth", 403),
    );

    await expect(caller.tiingo.saveKey({ apiKey: "bad-key" })).rejects.toThrow(
      /Tiingo rejected the API key/,
    );
    expect(storedRow()).toBeUndefined();
  });

  it("does not blame the key when Tiingo is unreachable or rate-limited", async () => {
    testApiKey.mockRejectedValueOnce(
      new BudgetApiError("Rate limited (429)", "rate-limit", 429),
    );

    await expect(caller.tiingo.saveKey({ apiKey: "good-key" })).rejects.toThrow(
      /Couldn't reach Tiingo/,
    );
    expect(storedRow()).toBeUndefined();
  });

  it("validates, then stores the key encrypted (never in plaintext)", async () => {
    testApiKey.mockResolvedValueOnce({
      ticker: "SPY",
      startDate: "1993-01-29",
    });

    await caller.tiingo.saveKey({ apiKey: "  good-key-123  " });

    expect(testApiKey).toHaveBeenLastCalledWith("good-key-123");
    const row = storedRow();
    expect(row).toBeDefined();
    expect(JSON.stringify(row!.config)).not.toContain("good-key-123");
  });

  it("getStatus reports connected without returning the key", async () => {
    const status = await caller.tiingo.getStatus();
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain("good-key-123");
  });

  it("testConnection decrypts the stored key and returns the history start", async () => {
    testApiKey.mockResolvedValueOnce({
      ticker: "SPY",
      startDate: "1993-01-29",
    });

    const result = await caller.tiingo.testConnection();

    expect(testApiKey).toHaveBeenLastCalledWith("good-key-123");
    expect(result).toEqual({
      success: true,
      ticker: "SPY",
      historyStart: "1993-01-29",
    });
  });

  it("testConnection reports an undecryptable stored key instead of throwing", async () => {
    const row = storedRow()!;
    db.update(sqliteSchema.apiConnections)
      .set({
        // Well-formed envelope that can't be decrypted (wrong key/tag).
        config: { v: 1, iv: "AAAA", ct: "AAAA", tag: "AAAA" } as never,
      })
      .where(eq(sqliteSchema.apiConnections.id, row.id))
      .run();

    const result = await caller.tiingo.testConnection();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).not.toBe(
      "No Tiingo connection configured",
    );
  });

  it("removeConnection deletes the stored key", async () => {
    await caller.tiingo.removeConnection();
    expect(storedRow()).toBeUndefined();
    expect((await caller.tiingo.getStatus()).connected).toBe(false);
  });

  describe("syncProcedure enforcement", () => {
    it("rejects saveKey from a viewer without sync permission", async () => {
      const session = createViewerSessionWithPermissions(["budget"]);
      const { caller: viewer, cleanup: done } = await createTestCaller(session);
      try {
        await expect(viewer.tiingo.saveKey({ apiKey: "x" })).rejects.toThrow();
      } finally {
        done();
      }
    });

    it("allows testConnection for a viewer with sync permission", async () => {
      const session = createViewerSessionWithPermissions(["sync"]);
      const { caller: viewer, cleanup: done } = await createTestCaller(session);
      try {
        const result = await viewer.tiingo.testConnection();
        expect(result.success).toBe(false);
      } finally {
        done();
      }
    });
  });
});
