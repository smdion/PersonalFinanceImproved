/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Additional sync-connections router coverage tests.
 *
 * Targets uncovered lines in src/server/routers/sync-connections.ts:
 *   - saveConnection (ynab + actual discriminated union)
 *   - fetchYnabBudgets (mocked fetch)
 *   - deleteConnection (with active API reset)
 *   - getSyncStatus (with active API)
 *   - getConnection (with connections present)
 *   - testConnection (with client that succeeds / throws)
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, adminSession } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

const mockGetActiveBudgetApi = vi.fn().mockResolvedValue("none");
const mockGetApiConnection = vi.fn().mockResolvedValue(null);
const mockGetClientForService = vi.fn().mockResolvedValue(null);
const mockCacheClear = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: (...args: unknown[]) => mockGetActiveBudgetApi(...args),
  getApiConnection: (...args: unknown[]) => mockGetApiConnection(...args),
  getClientForService: (...args: unknown[]) => mockGetClientForService(...args),
  cacheClear: (...args: unknown[]) => mockCacheClear(...args),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// saveConnection
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.saveConnection", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("saves a YNAB connection", async () => {
    const result = await caller.sync.saveConnection({
      service: "ynab",
      accessToken: "test-token-abc",
      budgetId: "budget-123",
    });
    expect(result).toEqual({ success: true });
  });

  it("saves an Actual connection", async () => {
    const result = await caller.sync.saveConnection({
      service: "actual",
      serverUrl: "https://actual.example.com",
      apiKey: "ak-xyz",
      budgetSyncId: "sync-456",
    });
    expect(result).toEqual({ success: true });
  });

  it("upserts YNAB connection on re-save", async () => {
    const result = await caller.sync.saveConnection({
      service: "ynab",
      accessToken: "updated-token",
      budgetId: "budget-999",
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects YNAB with empty accessToken", async () => {
    await expect(
      caller.sync.saveConnection({
        service: "ynab",
        accessToken: "",
        budgetId: "budget-123",
      }),
    ).rejects.toThrow();
  });

  it("rejects Actual with invalid serverUrl", async () => {
    await expect(
      caller.sync.saveConnection({
        service: "actual",
        serverUrl: "not-a-url",
        apiKey: "ak-xyz",
        budgetSyncId: "sync-456",
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// testConnection — with mocked client
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.testConnection with client", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => {
    cleanup();
    mockGetClientForService.mockResolvedValue(null);
  });

  it("returns success with budget name when client works", async () => {
    mockGetClientForService.mockResolvedValueOnce({
      getBudgetName: vi.fn().mockResolvedValue("My Budget"),
    });

    const result = await caller.sync.testConnection({ service: "ynab" });
    expect(result.success).toBe(true);
    expect(result.budgetName).toBe("My Budget");
  });

  it("returns failure when client throws", async () => {
    mockGetClientForService.mockResolvedValueOnce({
      getBudgetName: vi.fn().mockRejectedValue(new Error("Auth failed")),
    });

    const result = await caller.sync.testConnection({ service: "ynab" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Auth failed");
  });

  it("returns failure when no client configured", async () => {
    mockGetClientForService.mockResolvedValueOnce(null);

    const result = await caller.sync.testConnection({ service: "actual" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No actual connection configured");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getConnection — with connections present
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.getConnection with connections", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => {
    cleanup();
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetApiConnection.mockResolvedValue(null);
  });

  it("reports connected services with lastSyncedAt", async () => {
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockGetApiConnection
      .mockResolvedValueOnce({ lastSyncedAt: "2026-01-15T10:00:00Z" }) // ynab
      .mockResolvedValueOnce(null); // actual

    const result = await caller.sync.getConnection();
    expect(result.activeApi).toBe("ynab");
    expect(result.ynab.connected).toBe(true);
    expect(result.ynab.lastSyncedAt).toBe("2026-01-15T10:00:00Z");
    expect(result.actual.connected).toBe(false);
    expect(result.actual.lastSyncedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSyncStatus — with active API
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.getSyncStatus with active API", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => {
    cleanup();
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetApiConnection.mockResolvedValue(null);
  });

  it("returns connected status when API is active and connected", async () => {
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockGetApiConnection.mockResolvedValueOnce({
      lastSyncedAt: "2026-03-01T08:30:00Z",
    });

    const result = await caller.sync.getSyncStatus();
    expect(result.service).toBe("ynab");
    expect(result.connected).toBe(true);
    expect(result.lastSynced).toBe("2026-03-01T08:30:00Z");
  });

  it("returns not connected when API is active but no connection record", async () => {
    mockGetActiveBudgetApi.mockResolvedValueOnce("actual");
    mockGetApiConnection.mockResolvedValueOnce(null);

    const result = await caller.sync.getSyncStatus();
    expect(result.service).toBe("actual");
    expect(result.connected).toBe(false);
    expect(result.lastSynced).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteConnection — with active API reset
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.deleteConnection with active API", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let _db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    _db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => {
    cleanup();
    mockGetActiveBudgetApi.mockResolvedValue("none");
  });

  it("deletes connection and resets active API when deleting the active service", async () => {
    // First save a connection
    await caller.sync.saveConnection({
      service: "ynab",
      accessToken: "token-to-delete",
      budgetId: "budget-delete",
    });

    // Mock: after deletion, the active API is the one being deleted
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");

    const result = await caller.sync.deleteConnection({ service: "ynab" });
    expect(result).toEqual({ success: true });
    expect(mockCacheClear).toHaveBeenCalled();
  });

  it("deletes connection without resetting when deleting non-active service", async () => {
    await caller.sync.saveConnection({
      service: "actual",
      serverUrl: "https://actual.example.com",
      apiKey: "ak-xyz",
      budgetSyncId: "sync-456",
    });

    // Mock: active is ynab, we're deleting actual
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");

    const result = await caller.sync.deleteConnection({ service: "actual" });
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchYnabBudgets — mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.fetchYnabBudgets", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("returns budgets on successful YNAB API call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: {
          budgets: [
            { id: "b-1", name: "Main Budget", last_modified_on: "2026-01-01" },
            {
              id: "b-2",
              name: "Savings Budget",
              last_modified_on: "2026-02-01",
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await caller.sync.fetchYnabBudgets({
      accessToken: "test-token",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.budgets).toHaveLength(2);
      expect(result.budgets![0]!.name).toBe("Main Budget");
    }
  });

  it("returns error on YNAB API failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    }) as unknown as typeof fetch;

    const result = await caller.sync.fetchYnabBudgets({
      accessToken: "bad-token",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("401");
    }
  });

  it("returns error on network failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    const result = await caller.sync.fetchYnabBudgets({
      accessToken: "any-token",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Network error");
    }
  });
});
