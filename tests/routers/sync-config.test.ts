/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Sync config router integration tests.
 *
 * Tests active budget API setting, linked profile/column, and category skip/unskip.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedBudgetProfile } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  getApiConnection: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

describe("sync config router", () => {
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

  describe("getActiveBudgetApi", () => {
    it("returns 'none' when no API is configured", async () => {
      const result = await caller.sync.getActiveBudgetApi();
      expect(result).toBe("none");
    });
  });

  describe("setActiveBudgetApi", () => {
    it("can set to 'none' without a connection", async () => {
      const result = await caller.sync.setActiveBudgetApi({ value: "none" });
      expect(result).toEqual({ success: true });
    });

    it("throws PRECONDITION_FAILED when activating ynab without connection", async () => {
      // getApiConnection is mocked to return null, so no connection exists
      await expect(
        caller.sync.setActiveBudgetApi({ value: "ynab" }),
      ).rejects.toThrow(/No ynab connection configured/);
    });

    it("throws PRECONDITION_FAILED when activating actual without connection", async () => {
      await expect(
        caller.sync.setActiveBudgetApi({ value: "actual" }),
      ).rejects.toThrow(/No actual connection configured/);
    });
  });

  describe("setLinkedProfile", () => {
    it("succeeds even when no connection row exists (updates 0 rows)", async () => {
      const result = await caller.sync.setLinkedProfile({
        service: "ynab",
        profileId: 1,
      });
      expect(result).toEqual({ ok: true });
    });

    it("updates the linked profile on an existing connection", async () => {
      const profileId = await seedBudgetProfile(db, "Test Profile");
      // Insert a connection row first
      db.insert(schema.apiConnections)
        .values({
          service: "ynab",
          config: { apiKey: "test" },
        })
        .run();

      const result = await caller.sync.setLinkedProfile({
        service: "ynab",
        profileId,
      });
      expect(result).toEqual({ ok: true });

      // Verify the row was updated
      const rows = db.select().from(schema.apiConnections).all();
      const ynabRow = rows.find((r) => r.service === "ynab");
      expect(ynabRow?.linkedProfileId).toBe(profileId);
    });
  });

  describe("setLinkedColumn", () => {
    it("updates the linked column index", async () => {
      // Connection row already exists from prior test
      const result = await caller.sync.setLinkedColumn({
        service: "ynab",
        columnIndex: 2,
      });
      expect(result).toEqual({ ok: true });

      const rows = db.select().from(schema.apiConnections).all();
      const ynabRow = rows.find((r) => r.service === "ynab");
      expect(ynabRow?.linkedColumnIndex).toBe(2);
    });

    it("succeeds with columnIndex 0", async () => {
      const result = await caller.sync.setLinkedColumn({
        service: "ynab",
        columnIndex: 0,
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("skipCategory", () => {
    it("throws NOT_FOUND when no connection exists", async () => {
      // Use getApiConnection mock which returns null
      await expect(
        caller.sync.skipCategory({ service: "actual", categoryId: "cat-1" }),
      ).rejects.toThrow(/No connection/);
    });
  });

  describe("unskipCategory", () => {
    it("throws NOT_FOUND when no connection exists", async () => {
      await expect(
        caller.sync.unskipCategory({ service: "actual", categoryId: "cat-1" }),
      ).rejects.toThrow(/No connection/);
    });
  });
});

describe("sync config router — skip/unskip with connection", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed a ynab connection so getApiConnection works.
    // We need to override the mock for this suite.
    const { getApiConnection } = await import("@/lib/budget-api");
    const mockedGetApiConnection = vi.mocked(getApiConnection);
    // Store a real row
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        skippedCategoryIds: [],
      })
      .run();

    // Make mock read from DB
    mockedGetApiConnection.mockImplementation(async (_db, service) => {
      const rows = db.select().from(schema.apiConnections).all();
      const row = rows.find((r) => r.service === service);
      if (!row) return null;
      return row as unknown;
    });
  });

  afterAll(() => cleanup());

  it("skipCategory adds a category to skipped list", async () => {
    const result = await caller.sync.skipCategory({
      service: "ynab",
      categoryId: "cat-abc",
    });
    expect(result).toEqual({ ok: true });

    const rows = db.select().from(schema.apiConnections).all();
    const ynab = rows.find((r) => r.service === "ynab");
    expect(ynab?.skippedCategoryIds).toContain("cat-abc");
  });

  it("skipCategory is idempotent", async () => {
    await caller.sync.skipCategory({ service: "ynab", categoryId: "cat-abc" });
    const result = await caller.sync.skipCategory({
      service: "ynab",
      categoryId: "cat-abc",
    });
    expect(result).toEqual({ ok: true });

    const rows = db.select().from(schema.apiConnections).all();
    const ynab = rows.find((r) => r.service === "ynab");
    const count = (ynab?.skippedCategoryIds ?? []).filter(
      (id) => id === "cat-abc",
    ).length;
    expect(count).toBe(1);
  });

  it("unskipCategory removes a category from skipped list", async () => {
    // First ensure it's skipped
    await caller.sync.skipCategory({ service: "ynab", categoryId: "cat-xyz" });
    let rows = db.select().from(schema.apiConnections).all();
    expect(
      rows.find((r) => r.service === "ynab")?.skippedCategoryIds,
    ).toContain("cat-xyz");

    const result = await caller.sync.unskipCategory({
      service: "ynab",
      categoryId: "cat-xyz",
    });
    expect(result).toEqual({ ok: true });

    rows = db.select().from(schema.apiConnections).all();
    expect(
      rows.find((r) => r.service === "ynab")?.skippedCategoryIds,
    ).not.toContain("cat-xyz");
  });

  it("unskipCategory is idempotent when category not in list", async () => {
    const result = await caller.sync.unskipCategory({
      service: "ynab",
      categoryId: "nonexistent",
    });
    expect(result).toEqual({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActiveBudgetApiLink — the nav's "open budget API" link
// ─────────────────────────────────────────────────────────────────────────────

describe("sync config router — getActiveBudgetApiLink", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("returns a null url when no API is active", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    vi.mocked(getActiveBudgetApi).mockResolvedValueOnce("none");

    const result = await caller.sync.getActiveBudgetApiLink();
    expect(result).toEqual({ service: "none", url: null });
  });

  it("YNAB always links to the hosted app, regardless of saved config", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    vi.mocked(getActiveBudgetApi).mockResolvedValueOnce("ynab");

    const result = await caller.sync.getActiveBudgetApiLink();
    expect(result).toEqual({
      service: "ynab",
      url: "https://app.youneedabudget.com/",
    });
  });

  it("Actual links to the saved External URL when set", async () => {
    const { getActiveBudgetApi, getApiConnection } =
      await import("@/lib/budget-api");
    vi.mocked(getActiveBudgetApi).mockResolvedValueOnce("actual");
    vi.mocked(getApiConnection).mockResolvedValueOnce({
      config: {
        serverUrl: "http://10.0.0.5:5006",
        apiKey: "ak",
        budgetSyncId: "sync-1",
        externalUrl: "https://actual.mydomain.com",
      },
    } as unknown as Awaited<ReturnType<typeof getApiConnection>>);

    const result = await caller.sync.getActiveBudgetApiLink();
    expect(result).toEqual({
      service: "actual",
      url: "https://actual.mydomain.com",
    });
  });

  it("Actual has no link when connected but no External URL was ever saved — serverUrl (often internal/behind a reverse proxy) is never used as a fallback", async () => {
    const { getActiveBudgetApi, getApiConnection } =
      await import("@/lib/budget-api");
    vi.mocked(getActiveBudgetApi).mockResolvedValueOnce("actual");
    vi.mocked(getApiConnection).mockResolvedValueOnce({
      config: {
        serverUrl: "http://10.0.0.5:5006",
        apiKey: "ak",
        budgetSyncId: "sync-1",
      },
    } as unknown as Awaited<ReturnType<typeof getApiConnection>>);

    const result = await caller.sync.getActiveBudgetApiLink();
    expect(result).toEqual({ service: "actual", url: null });
  });

  it("Actual has no link when active but never connected", async () => {
    const { getActiveBudgetApi, getApiConnection } =
      await import("@/lib/budget-api");
    vi.mocked(getActiveBudgetApi).mockResolvedValueOnce("actual");
    vi.mocked(getApiConnection).mockResolvedValueOnce(null);

    const result = await caller.sync.getActiveBudgetApiLink();
    expect(result).toEqual({ service: "actual", url: null });
  });
});
