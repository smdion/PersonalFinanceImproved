/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Sync mappings router integration tests.
 *
 * Tests account mapping CRUD, createAssetAndMap, pullAssetsFromApi,
 * pushPortfolioToApi, and migrateAccountMappingsToIds.
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
import {
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

// Keep references to mocks so we can adjust per test
const mockGetActiveBudgetApi = vi.fn().mockResolvedValue("none");
const mockGetClientForService = vi.fn().mockResolvedValue(null);
const mockGetApiConnection = vi.fn().mockResolvedValue(null);
const mockCacheGet = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: (...args: unknown[]) => mockGetActiveBudgetApi(...args),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  getClientForService: (...args: unknown[]) => mockGetClientForService(...args),
  getApiConnection: (...args: unknown[]) => mockGetApiConnection(...args),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
}));

// ── Basic CRUD ───────────────────────────────────────────────────────

describe("sync mappings — basic operations", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetClientForService.mockResolvedValue(null);
    mockGetApiConnection.mockResolvedValue(null);
    mockCacheGet.mockResolvedValue(null);
  });

  describe("updateAccountMappings", () => {
    it("succeeds with empty mappings array", async () => {
      const result = await caller.sync.updateAccountMappings({
        service: "ynab",
        mappings: [],
      });
      expect(result).toEqual({ success: true });
    });

    it("persists mappings to the connection row", async () => {
      // Seed a connection row
      db.insert(schema.apiConnections)
        .values({ service: "ynab", config: { apiKey: "test" } })
        .run();

      const mappings = [
        {
          localId: "asset:10",
          localName: "Savings Bond",
          remoteAccountId: "remote-acct-1",
          syncDirection: "pull" as const,
          assetId: 10,
        },
        {
          localName: "Investment",
          remoteAccountId: "remote-acct-2",
          syncDirection: "push" as const,
        },
      ];

      const result = await caller.sync.updateAccountMappings({
        service: "ynab",
        mappings,
      });
      expect(result).toEqual({ success: true });

      // Verify DB
      const rows = db.select().from(schema.apiConnections).all();
      const ynab = rows.find((r) => r.service === "ynab");
      expect(ynab?.accountMappings).toHaveLength(2);
      expect(ynab?.accountMappings![0]!.localName).toBe("Savings Bond");
    });

    it("replaces existing mappings entirely", async () => {
      // Update to single mapping
      await caller.sync.updateAccountMappings({
        service: "ynab",
        mappings: [
          {
            localName: "Only One",
            remoteAccountId: "r-1",
            syncDirection: "both",
          },
        ],
      });

      const rows = db.select().from(schema.apiConnections).all();
      const ynab = rows.find((r) => r.service === "ynab");
      expect(ynab?.accountMappings).toHaveLength(1);
      expect(ynab?.accountMappings![0]!.localName).toBe("Only One");
    });
  });
});

// ── createAssetAndMap ────────────────────────────────────────────────

describe("sync mappings — createAssetAndMap", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed a ynab connection
    db.insert(schema.apiConnections)
      .values({ service: "ynab", config: { apiKey: "test" } })
      .run();

    // Make getApiConnection read from real DB
    mockGetApiConnection.mockImplementation(
      async (_db: unknown, service: string) => {
        const rows = db.select().from(schema.apiConnections).all();
        const row = rows.find((r) => r.service === service);
        if (!row) return null;
        return row as unknown;
      },
    );
  });

  afterAll(() => cleanup());

  it("creates an asset item and adds a mapping", async () => {
    const result = await caller.sync.createAssetAndMap({
      service: "ynab",
      assetName: "New Vehicle",
      balance: 25000,
      remoteAccountId: "ynab-track-1",
      syncDirection: "pull",
    });
    expect(result).toEqual({ success: true });

    // Verify asset was created
    const assets = db.select().from(schema.otherAssetItems).all();
    const vehicle = assets.find((a) => a.name === "New Vehicle");
    expect(vehicle).toBeDefined();
    expect(vehicle!.value).toBe("25000");
    expect(vehicle!.year).toBe(new Date().getFullYear());

    // Verify mapping was added
    const conns = db.select().from(schema.apiConnections).all();
    const ynab = conns.find((r) => r.service === "ynab");
    const mapping = ynab?.accountMappings?.find(
      (m) => m.localName === "New Vehicle",
    );
    expect(mapping).toBeDefined();
    expect(mapping!.remoteAccountId).toBe("ynab-track-1");
    expect(mapping!.syncDirection).toBe("pull");
    expect(mapping!.assetId).toBe(vehicle!.id);
  });

  it("upserts asset if name+year already exists", async () => {
    const result = await caller.sync.createAssetAndMap({
      service: "ynab",
      assetName: "New Vehicle",
      balance: 23000, // Updated balance
      remoteAccountId: "ynab-track-2",
      syncDirection: "both",
    });
    expect(result).toEqual({ success: true });

    // Should have same name/year but updated value
    const assets = db
      .select()
      .from(schema.otherAssetItems)
      .all()
      .filter(
        (a) => a.name === "New Vehicle" && a.year === new Date().getFullYear(),
      );
    expect(assets).toHaveLength(1);
    expect(assets[0]!.value).toBe("23000");
  });
});

// ── pushPortfolioToApi ───────────────────────────────────────────────

// ── resyncPortfolioPush ─────────────────────────────────────────────────────

describe("sync mappings — resyncPortfolioPush", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockGetClientForService.mockResolvedValue(null);
    mockGetApiConnection.mockResolvedValue(null);
  });

  it("blocks non-latest snapshot resync without confirmNonLatest", async () => {
    const perfId = seedPerformanceAccount(db, { accountLabel: "Resync Old" });
    const olderSnap = seedSnapshot(db, "2026-01-01", [
      { performanceAccountId: perfId, amount: "1000" },
    ]);
    seedSnapshot(db, "2026-02-01", [
      { performanceAccountId: perfId, amount: "1100" },
    ]);

    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: vi.fn(),
      getAccountTransactions: vi.fn(),
      getAccountBalance: vi.fn(),
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfId}`,
          localName: "Resync Old",
          remoteAccountId: "ynab-old",
          syncDirection: "push",
          performanceAccountId: perfId,
        },
      ],
    });

    await expect(
      caller.sync.resyncPortfolioPush({ snapshotId: olderSnap }),
    ).rejects.toThrow(/non-latest snapshot causes historical drift/);
  });

  it("deletes prior tagged transactions and posts fresh ones in resync mode", async () => {
    const perfId = seedPerformanceAccount(db, {
      accountLabel: "Resync Latest",
    });
    const snapId = seedSnapshot(db, "2026-04-01", [
      { performanceAccountId: perfId, amount: "10000" },
    ]);

    const mockCreateTransaction = vi.fn().mockResolvedValue("tx-fresh");
    const mockDeleteTransaction = vi.fn().mockResolvedValue(undefined);
    const mockGetAccountTransactions = vi.fn().mockResolvedValue([
      {
        id: "old-tagged-tx",
        accountId: "ynab-resync",
        accountName: "Resync Track",
        date: "2026-04-01",
        amount: 500,
        payeeName: "Portfolio Sync",
        categoryId: null,
        categoryName: null,
        memo: `Ledgr snapshot:${snapId} - Resync Latest`,
        cleared: true,
        approved: true,
        deleted: false,
      },
    ]);

    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: mockGetAccountTransactions,
      getAccountBalance: vi.fn().mockResolvedValue(9500),
      deleteTransaction: mockDeleteTransaction,
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfId}`,
          localName: "Resync Latest",
          remoteAccountId: "ynab-resync",
          syncDirection: "push",
          performanceAccountId: perfId,
        },
      ],
    });

    const result = await caller.sync.resyncPortfolioPush({
      snapshotId: snapId,
    });
    expect(mockDeleteTransaction).toHaveBeenCalledWith("old-tagged-tx");
    expect(result.cleaned).toBe(1);
    expect(result.posted).toBe(1);
    // After cleanup, the live balance is 9500. Snapshot is 10000.
    // Diff = 500.
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "ynab-resync", amount: 500 }),
    );
  });

  it("aborts before posting when cleanup delete fails partway", async () => {
    const perfId = seedPerformanceAccount(db, {
      accountLabel: "Resync Cleanup Fail",
    });
    const snapId = seedSnapshot(db, "2026-04-05", [
      { performanceAccountId: perfId, amount: "5000" },
    ]);

    const mockCreateTransaction = vi.fn();
    const mockDeleteTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("YNAB 403"));
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: vi.fn().mockResolvedValue([
        {
          id: "stuck-tx",
          accountId: "ynab-stuck",
          accountName: "Stuck Track",
          date: "2026-04-05",
          amount: 100,
          payeeName: "Portfolio Sync",
          categoryId: null,
          categoryName: null,
          memo: `Ledgr snapshot:${snapId}`,
          cleared: true,
          approved: true,
          deleted: false,
        },
      ]),
      getAccountBalance: vi.fn(),
      deleteTransaction: mockDeleteTransaction,
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfId}`,
          localName: "Stuck",
          remoteAccountId: "ynab-stuck",
          syncDirection: "push",
          performanceAccountId: perfId,
        },
      ],
    });

    await expect(
      caller.sync.resyncPortfolioPush({ snapshotId: snapId }),
    ).rejects.toThrow(/Resync cleanup partially failed/);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  it("returns no-op when no mappings configured", async () => {
    const perfId = seedPerformanceAccount(db, { accountLabel: "No Map" });
    const snapId = seedSnapshot(db, "2026-04-09", [
      { performanceAccountId: perfId, amount: "1" },
    ]);
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: vi.fn(),
      getAccountTransactions: vi.fn(),
      getAccountBalance: vi.fn(),
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({ accountMappings: [] });
    const result = await caller.sync.resyncPortfolioPush({
      snapshotId: snapId,
    });
    expect(result.posted).toBe(0);
    expect(result.cleaned).toBe(0);
  });

  it("throws PRECONDITION_FAILED when no API active", async () => {
    await expect(
      caller.sync.resyncPortfolioPush({ snapshotId: 1 }),
    ).rejects.toThrow(/No budget API active/);
  });
});

// ── pullPortfolioFromApi ───────────────────────────────────────────────

// ── pullAssetsFromApi ────────────────────────────────────────────────

// ── migrateAccountMappingsToIds ──────────────────────────────────────
