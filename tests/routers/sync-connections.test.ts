/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Sync connections router integration tests: connection status with nothing
 * configured, then each procedure with connections present —
 * saveConnection (ynab + actual), fetchYnabBudgets (mocked fetch),
 * deleteConnection (with active API reset), getSyncStatus, getConnection
 * and testConnection (a client that succeeds / throws), and who may manage a
 * connection (admins; a sync-only viewer is refused). Real API calls are
 * never made: @/lib/budget-api is mocked.
 */
import "./setup-mocks";
import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { serviceError } from "@/lib/budget-api/errors";
import {
  createTestCaller,
  adminSession,
  createViewerSessionWithPermissions,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

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

describe("sync connections router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // Later suites in this file reconfigure the budget-api mocks; these run
  // with nothing configured.
  beforeEach(() => {
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetApiConnection.mockResolvedValue(null);
    mockGetClientForService.mockResolvedValue(null);
  });

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
      expect(result).toEqual({ ok: true });
    });
  });

  describe("testConnection", () => {
    it("returns failure when no connection configured", async () => {
      const result = await caller.sync.testConnection({
        service: "ynab",
      });
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("No ynab connection configured"),
      });
    });
  });
});

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
    expect(result).toEqual({ ok: true });
  });

  it("saves an Actual connection", async () => {
    const result = await caller.sync.saveConnection({
      service: "actual",
      serverUrl: "https://actual.example.com",
      apiKey: "ak-xyz",
      budgetSyncId: "sync-456",
    });
    expect(result).toEqual({ ok: true });
  });

  it("upserts YNAB connection on re-save", async () => {
    const result = await caller.sync.saveConnection({
      service: "ynab",
      accessToken: "updated-token",
      budgetId: "budget-999",
    });
    expect(result).toEqual({ ok: true });
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

  it.each(["http://actual-http-api:5007", "http://10.0.0.5:5006"])(
    "saves an Actual connection to the admin's private host %s",
    async (serverUrl) => {
      const result = await caller.sync.saveConnection({
        service: "actual",
        serverUrl,
        apiKey: "ak-xyz",
        budgetSyncId: "sync-456",
      });
      expect(result).toEqual({ ok: true });
    },
  );

  it.each([
    ["http://u:p@actual-http-api:5007", /user name or password/],
    ["ftp://actual-http-api:5007", /scheme/],
  ])("refuses to save the Actual URL %s", async (serverUrl, why) => {
    await expect(
      caller.sync.saveConnection({
        service: "actual",
        serverUrl,
        apiKey: "ak-xyz",
        budgetSyncId: "sync-456",
      }),
    ).rejects.toThrow(why);
  });

  it("saves an Actual connection's optional External URL alongside credentials", async () => {
    const result = await caller.sync.saveConnection({
      service: "actual",
      serverUrl: "https://actual.example.com",
      apiKey: "ak-xyz",
      budgetSyncId: "sync-456",
      externalUrl: "https://actual.mydomain.com",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects an Actual connection with a malformed External URL", async () => {
    await expect(
      caller.sync.saveConnection({
        service: "actual",
        serverUrl: "https://actual.example.com",
        apiKey: "ak-xyz",
        budgetSyncId: "sync-456",
        externalUrl: "not-a-url",
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateActualExternalUrl — quick-edit for the External URL alone
// ─────────────────────────────────────────────────────────────────────────────

describe("sync.updateActualExternalUrl", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    mockGetApiConnection.mockImplementation(async (_db, service) => {
      const rows = db.select().from(schema.apiConnections).all();
      const row = rows.find((r) => r.service === service);
      return row ?? null;
    });
  });

  afterAll(() => {
    cleanup();
    mockGetApiConnection.mockResolvedValue(null);
  });

  it("throws NOT_FOUND when Actual isn't connected yet", async () => {
    await expect(
      caller.sync.updateActualExternalUrl({
        externalUrl: "https://actual.mydomain.com",
      }),
    ).rejects.toThrow("No Actual Budget connection configured");
  });

  it("sets, then clears, the External URL without touching other credential fields", async () => {
    await caller.sync.saveConnection({
      service: "actual",
      serverUrl: "https://actual.example.com",
      apiKey: "ak-xyz",
      budgetSyncId: "sync-456",
    });

    const setResult = await caller.sync.updateActualExternalUrl({
      externalUrl: "https://actual.mydomain.com",
    });
    expect(setResult).toEqual({ ok: true });

    const afterSet = await caller.sync.getConnection();
    expect(afterSet.actual.externalUrl).toBe("https://actual.mydomain.com");

    const clearResult = await caller.sync.updateActualExternalUrl({
      externalUrl: "",
    });
    expect(clearResult).toEqual({ ok: true });

    const afterClear = await caller.sync.getConnection();
    expect(afterClear.actual.externalUrl).toBeNull();
    // Still connected — clearing the External URL must not touch apiKey/
    // serverUrl/budgetSyncId.
    expect(afterClear.actual.connected).toBe(true);
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
      testConnection: vi.fn().mockResolvedValue(undefined),
      getBudgetName: vi.fn().mockResolvedValue("My Budget"),
    });

    const result = await caller.sync.testConnection({ service: "ynab" });
    expect(result).toMatchObject({ success: true, budgetName: "My Budget" });
  });

  it("returns failure when client throws", async () => {
    mockGetClientForService.mockResolvedValueOnce({
      testConnection: vi.fn().mockRejectedValue(new Error("Auth failed")),
      getBudgetName: vi.fn(),
    });

    const result = await caller.sync.testConnection({ service: "ynab" });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Auth failed"),
    });
  });

  it("asks the budget even when its name is local (Actual), and says why it failed", async () => {
    const bad = serviceError(
      "Actual",
      "Actual: /accounts: raw",
      "bad-response",
    );
    bad.field = "data.0.offbudget";
    const getBudgetName = vi.fn().mockResolvedValue("Actual (abc...)");
    mockGetClientForService.mockResolvedValueOnce({
      testConnection: vi.fn().mockRejectedValue(bad),
      getBudgetName,
    });

    expect(await caller.sync.testConnection({ service: "actual" })).toEqual({
      success: false,
      error:
        "Actual sent something Ledgr doesn't understand (data.0.offbudget).",
    });
    expect(getBudgetName).not.toHaveBeenCalled();
  });

  it("returns failure when no client configured", async () => {
    mockGetClientForService.mockResolvedValueOnce(null);

    const result = await caller.sync.testConnection({ service: "actual" });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("No actual connection configured"),
    });
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
    expect(result).toEqual({ ok: true });
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
    expect(result).toEqual({ ok: true });
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

  /** YNAB answering every request with `status` and `body`. */
  function ynabAnswers(status: number, body: unknown) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(text),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("lists the token's budgets from YNAB's /budgets", async () => {
    const fetchMock = ynabAnswers(200, {
      data: {
        budgets: [
          { id: "b-1", name: "Main Budget", last_modified_on: "2026-01-01" },
          { id: "b-2", name: "Savings Budget" },
        ],
        default_budget: null,
      },
    });

    const result = await caller.sync.fetchYnabBudgets({
      accessToken: "test-token",
    });
    expect(result).toEqual({
      success: true,
      budgets: [
        { id: "b-1", name: "Main Budget", lastModified: "2026-01-01" },
        { id: "b-2", name: "Savings Budget", lastModified: null },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.ynab.com/v1/budgets?include_accounts=false");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("a token YNAB refuses says so, without YNAB's answer", async () => {
    ynabAnswers(401, '{"error":{"id":"401","detail":"token-detail-xyz"}}');
    const result = await caller.sync.fetchYnabBudgets({
      accessToken: "bad-token",
    });
    expect(result).toEqual({
      success: false,
      error: "YNAB didn't accept this access token — check it and try again.",
    });
  });

  it("any other failure is told in words, never as YNAB's raw body", async () => {
    ynabAnswers(400, "body-detail-xyz");
    const result = await caller.sync.fetchYnabBudgets({ accessToken: "t" });
    expect(result).toEqual({
      success: false,
      error: "YNAB refused Ledgr's request.",
    });
  });

  it("a list in another shape is bad-response, naming the field", async () => {
    ynabAnswers(200, { data: { plans: [{ id: "b-1", name: "Main" }] } });
    const result = await caller.sync.fetchYnabBudgets({ accessToken: "t" });
    expect(result).toEqual({
      success: false,
      error: "YNAB sent something Ledgr doesn't understand (data.budgets).",
    });
  });

  it("returns error on network failure", async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(
          new TypeError("fetch failed"),
        ) as unknown as typeof fetch;
      const pending = caller.sync.fetchYnabBudgets({ accessToken: "t" });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toEqual({
        success: false,
        error: "Ledgr couldn't reach YNAB — try again.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Who may manage a connection: admins only, YNAB and Actual alike
// ─────────────────────────────────────────────────────────────────────────────

describe("connection management is admin-only", () => {
  const syncOnly = createViewerSessionWithPermissions(["sync"]);
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetApiConnection.mockResolvedValue(null);
    mockGetClientForService.mockClear().mockResolvedValue(null);
    mockCacheClear.mockClear();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  const ynabSave = {
    service: "ynab" as const,
    accessToken: "tok-viewer",
    budgetId: "budget-viewer",
  };
  const actualSave = {
    service: "actual" as const,
    serverUrl: "http://10.0.0.9:5007",
    apiKey: "ak-viewer",
    budgetSyncId: "sync-viewer",
  };

  it.each([ynabSave, actualSave])(
    "a sync-only viewer can't save a $service connection, and nothing is written",
    async (input) => {
      const { caller, db, cleanup } = await createTestCaller(syncOnly);
      try {
        await expect(caller.sync.saveConnection(input)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(db.select().from(schema.apiConnections).all()).toEqual([]);
      } finally {
        cleanup();
      }
    },
  );

  it.each(["ynab", "actual"] as const)(
    "a sync-only viewer can't test or delete the %s connection",
    async (service) => {
      const { caller, cleanup } = await createTestCaller(syncOnly);
      try {
        await expect(
          caller.sync.testConnection({ service }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          caller.sync.deleteConnection({ service }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(mockGetClientForService).not.toHaveBeenCalled();
        expect(mockCacheClear).not.toHaveBeenCalled();
      } finally {
        cleanup();
      }
    },
  );

  it("a sync-only viewer can't change Actual's External URL", async () => {
    const { caller, cleanup } = await createTestCaller(syncOnly);
    try {
      await expect(
        caller.sync.updateActualExternalUrl({
          externalUrl: "https://actual.example.com",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      cleanup();
    }
  });

  it("a sync-only viewer can't list a YNAB token's budgets, and YNAB isn't asked", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { caller, cleanup } = await createTestCaller(syncOnly);
    try {
      await expect(
        caller.sync.fetchYnabBudgets({ accessToken: "t" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("a sync-only viewer still reads the connection and sync status", async () => {
    const { caller, cleanup } = await createTestCaller(syncOnly);
    try {
      expect((await caller.sync.getConnection()).activeApi).toBe("none");
      expect((await caller.sync.getSyncStatus()).connected).toBe(false);
    } finally {
      cleanup();
    }
  });

  it.each([ynabSave, actualSave])(
    "an admin saves, tests and deletes a $service connection",
    async (input) => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        expect(await caller.sync.saveConnection(input)).toEqual({ ok: true });
        expect(
          db
            .select()
            .from(schema.apiConnections)
            .all()
            .map((r) => r.service),
        ).toEqual([input.service]);
        mockGetClientForService.mockResolvedValueOnce({
          testConnection: vi.fn().mockResolvedValue(undefined),
          getBudgetName: vi.fn().mockResolvedValue("Household"),
        });
        expect(
          await caller.sync.testConnection({ service: input.service }),
        ).toEqual({ success: true, budgetName: "Household" });
        expect(
          await caller.sync.deleteConnection({ service: input.service }),
        ).toEqual({ ok: true });
        expect(db.select().from(schema.apiConnections).all()).toEqual([]);
      } finally {
        cleanup();
      }
    },
  );
});
