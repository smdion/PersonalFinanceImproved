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

  describe("listAccountMappings", () => {
    it("returns empty mappings when no API active", async () => {
      const result = await caller.sync.listAccountMappings();
      expect(result.mappings).toEqual([]);
      expect(result.service).toBeNull();
    });

    it("returns mappings when API is active and connection has mappings", async () => {
      mockGetActiveBudgetApi.mockResolvedValue("ynab");
      mockGetApiConnection.mockResolvedValue({
        accountMappings: [
          {
            localId: "asset:1",
            localName: "Car",
            remoteAccountId: "remote-1",
            syncDirection: "pull",
            assetId: 1,
          },
        ],
      });

      const result = await caller.sync.listAccountMappings();
      expect(result.service).toBe("ynab");
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]!.localName).toBe("Car");
    });

    it("returns empty mappings when API is active but no connection found", async () => {
      mockGetActiveBudgetApi.mockResolvedValue("ynab");
      mockGetApiConnection.mockResolvedValue(null);

      const result = await caller.sync.listAccountMappings();
      expect(result.service).toBe("ynab");
      expect(result.mappings).toEqual([]);
    });
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

describe("sync mappings — pushPortfolioToApi", () => {
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

  it("throws PRECONDITION_FAILED when no API active", async () => {
    await expect(caller.sync.pushPortfolioToApi()).rejects.toThrow(
      /No budget API active/,
    );
  });

  it("throws PRECONDITION_FAILED when client not available", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue(null);

    await expect(caller.sync.pushPortfolioToApi()).rejects.toThrow(
      /Budget API client not available/,
    );
  });

  it("returns pushed:0 when no mappings configured", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({ createTransaction: vi.fn() });
    mockGetApiConnection.mockResolvedValue({ accountMappings: [] });

    const result = await caller.sync.pushPortfolioToApi();
    expect(result.pushed).toBe(0);
  });

  it("pushes portfolio balances to API tracking accounts", async () => {
    const perfAcctId = seedPerformanceAccount(db);
    const snapId = seedSnapshot(db, "2026-01-15", [
      { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
    ]);

    const mockCreateTransaction = vi.fn().mockResolvedValue("tx-new");
    const mockGetAccountTransactions = vi.fn().mockResolvedValue([]);
    const mockGetAccountBalance = vi.fn().mockResolvedValue(90000);
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: mockGetAccountTransactions,
      getAccountBalance: mockGetAccountBalance,
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfAcctId}`,
          localName: "401k",
          remoteAccountId: "ynab-track-401k",
          syncDirection: "push",
          performanceAccountId: perfAcctId,
        },
      ],
    });

    const result = await caller.sync.pushPortfolioToApi({ snapshotId: snapId });
    expect(result.pushed).toBe(1);
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ynab-track-401k",
        amount: 10000,
        payeeName: "Portfolio Sync",
      }),
    );
  });

  it("posts a zero-diff transaction when balance already matches", async () => {
    const perfAcctId = seedPerformanceAccount(db, { name: "Roth IRA" });
    seedSnapshot(db, "2026-02-01", [
      { performanceAccountId: perfAcctId, amount: "50000" },
    ]);

    const mockCreateTransaction = vi.fn().mockResolvedValue("tx-zero");
    const mockGetAccountTransactions = vi.fn().mockResolvedValue([]);
    const mockGetAccountBalance = vi.fn().mockResolvedValue(50000);
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: mockGetAccountTransactions,
      getAccountBalance: mockGetAccountBalance,
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfAcctId}`,
          localName: "Roth IRA",
          remoteAccountId: "ynab-roth",
          syncDirection: "push",
          performanceAccountId: perfAcctId,
        },
      ],
    });

    const result = await caller.sync.pushPortfolioToApi();
    expect(result.pushed).toBe(1);
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ynab-roth",
        amount: 0,
      }),
    );
  });

  it("dedupes by performanceAccountId so two mappings sharing one perf account are counted once", async () => {
    // Models the user's IRA case: two ledger-side mappings (Sean IRA, Joanna IRA)
    // both reference the same performance account (one IRA perf row that
    // aggregates both holders). The group total should equal one perf balance,
    // not double it.
    const sharedPerfId = seedPerformanceAccount(db, { name: "Joint IRA" });
    const snapId = seedSnapshot(db, "2026-03-01", [
      { performanceAccountId: sharedPerfId, amount: "30000" },
    ]);

    const mockCreateTransaction = vi.fn().mockResolvedValue("tx-dedup");
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: vi.fn().mockResolvedValue([]),
      getAccountBalance: vi.fn().mockResolvedValue(0),
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${sharedPerfId}`,
          localName: "Sean IRA",
          remoteAccountId: "ynab-ira",
          syncDirection: "push",
          performanceAccountId: sharedPerfId,
        },
        {
          localId: `performance:${sharedPerfId}`,
          localName: "Joanna IRA",
          remoteAccountId: "ynab-ira",
          syncDirection: "push",
          performanceAccountId: sharedPerfId,
        },
      ],
    });

    const result = await caller.sync.pushPortfolioToApi({ snapshotId: snapId });
    expect(result.pushed).toBe(1);
    // Posted amount must equal the perf account's balance (30000), not 2x
    expect(mockCreateTransaction).toHaveBeenCalledTimes(1);
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ynab-ira",
        amount: 30000,
      }),
    );
  });

  it("skips group on second sync (idempotency via snapshot tag)", async () => {
    const perfAcctId = seedPerformanceAccount(db, { name: "HSA" });
    const snapId = seedSnapshot(db, "2026-02-15", [
      { performanceAccountId: perfAcctId, amount: "25000" },
    ]);

    const mockCreateTransaction = vi.fn().mockResolvedValue("tx-1");
    // Existing tagged transaction simulates a prior sync
    const mockGetAccountTransactions = vi.fn().mockResolvedValue([
      {
        id: "prior-tx",
        accountId: "ynab-hsa",
        accountName: "HSA Track",
        date: "2026-02-15",
        amount: 1000,
        payeeName: "Portfolio Sync",
        categoryId: null,
        categoryName: null,
        memo: `Ledgr snapshot:${snapId} 2026-02-15 — HSA`,
        cleared: true,
        approved: true,
        deleted: false,
      },
    ]);
    const mockGetAccountBalance = vi.fn().mockResolvedValue(25000);
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      createTransaction: mockCreateTransaction,
      getAccountTransactions: mockGetAccountTransactions,
      getAccountBalance: mockGetAccountBalance,
      deleteTransaction: vi.fn(),
    });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `performance:${perfAcctId}`,
          localName: "HSA",
          remoteAccountId: "ynab-hsa",
          syncDirection: "push",
          performanceAccountId: perfAcctId,
        },
      ],
    });

    const result = await caller.sync.pushPortfolioToApi({ snapshotId: snapId });
    expect(result.pushed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when no snapshot exists", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({ createTransaction: vi.fn() });
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: "performance:999",
          localName: "Missing",
          remoteAccountId: "r-1",
          syncDirection: "push",
          performanceAccountId: 999,
        },
      ],
    });

    // Use a specific snapshotId that doesn't exist
    await expect(
      caller.sync.pushPortfolioToApi({ snapshotId: 99999 }),
    ).rejects.toThrow(/No portfolio snapshot found/);
  });
});

// ── pullAssetsFromApi ────────────────────────────────────────────────

describe("sync mappings — pullAssetsFromApi", () => {
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

  it("throws PRECONDITION_FAILED when no API active", async () => {
    await expect(caller.sync.pullAssetsFromApi()).rejects.toThrow(
      /No budget API active/,
    );
  });

  it("returns pulled:0 when no pull mappings configured", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localName: "push-only",
          remoteAccountId: "r-1",
          syncDirection: "push",
        },
      ],
    });

    const result = await caller.sync.pullAssetsFromApi();
    expect(result.pulled).toBe(0);
  });

  it("throws PRECONDITION_FAILED when no cached accounts", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localName: "Car",
          remoteAccountId: "r-1",
          syncDirection: "pull",
        },
      ],
    });
    mockCacheGet.mockResolvedValue(null);

    await expect(caller.sync.pullAssetsFromApi()).rejects.toThrow(
      /No cached accounts/,
    );
  });

  it("pulls asset values and creates new asset items", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localName: "Boat",
          remoteAccountId: "track-boat",
          syncDirection: "pull",
        },
      ],
    });
    mockCacheGet.mockResolvedValue({
      data: [{ id: "track-boat", name: "Boat Tracker", balance: 15000 }],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.pullAssetsFromApi();
    expect(result.pulled).toBe(1);

    // Verify asset was created
    const assets = db.select().from(schema.otherAssetItems).all();
    const boat = assets.find((a) => a.name === "Boat");
    expect(boat).toBeDefined();
    expect(boat!.value).toBe("15000");
    expect(boat!.year).toBe(new Date().getFullYear());
  });

  it("updates existing asset item for current year", async () => {
    // The "Boat" asset already exists from previous test
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localName: "Boat",
          remoteAccountId: "track-boat",
          syncDirection: "pull",
        },
      ],
    });
    mockCacheGet.mockResolvedValue({
      data: [{ id: "track-boat", name: "Boat Tracker", balance: 14000 }],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.pullAssetsFromApi();
    expect(result.pulled).toBe(1);

    const assets = db
      .select()
      .from(schema.otherAssetItems)
      .all()
      .filter((a) => a.name === "Boat" && a.year === new Date().getFullYear());
    expect(assets).toHaveLength(1);
    expect(assets[0]!.value).toBe("14000");
  });

  it("resolves asset by ID when assetId is set", async () => {
    // Create an asset with specific name
    db.insert(schema.otherAssetItems)
      .values({
        name: "Motorcycle",
        year: new Date().getFullYear(),
        value: "8000",
      })
      .run();
    const assetRow = db
      .select()
      .from(schema.otherAssetItems)
      .all()
      .find((a) => a.name === "Motorcycle")!;

    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `asset:${assetRow.id}`,
          localName: "Old Name", // localName doesn't matter — resolved by ID
          remoteAccountId: "track-moto",
          syncDirection: "pull",
          assetId: assetRow.id,
        },
      ],
    });
    mockCacheGet.mockResolvedValue({
      data: [{ id: "track-moto", name: "Motorcycle Tracker", balance: 7500 }],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.pullAssetsFromApi();
    expect(result.pulled).toBe(1);

    // Should update the "Motorcycle" row, not "Old Name"
    const assets = db
      .select()
      .from(schema.otherAssetItems)
      .all()
      .filter(
        (a) => a.name === "Motorcycle" && a.year === new Date().getFullYear(),
      );
    expect(assets).toHaveLength(1);
    expect(assets[0]!.value).toBe("7500");
  });

  it("skips mapping when remote account not in cache", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localName: "Ghost",
          remoteAccountId: "nonexistent-id",
          syncDirection: "pull",
        },
      ],
    });
    mockCacheGet.mockResolvedValue({
      data: [{ id: "other-id", name: "Some Account", balance: 1000 }],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.pullAssetsFromApi();
    expect(result.pulled).toBe(0);
  });
});

// ── migrateAccountMappingsToIds ──────────────────────────────────────

describe("sync mappings — migrateAccountMappingsToIds", () => {
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

  it("returns empty report when no connections exist", async () => {
    const result = await caller.sync.migrateAccountMappingsToIds();
    expect(result.report).toEqual([]);
  });

  it("migrates mortgage-pattern localName to typed fields", async () => {
    // Create a mortgage loan
    db.insert(schema.mortgageLoans)
      .values({
        name: "Home Loan",
        isActive: true,
        principalAndInterest: "1500",
        interestRate: "6.5",
        termYears: 30,
        originalLoanAmount: "300000",
        firstPaymentDate: "2024-01-01",
        propertyValuePurchase: "400000",
      })
      .run();
    const loan = db.select().from(schema.mortgageLoans).all()[0]!;

    // Create a connection with legacy mortgage mapping (no localId)
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        accountMappings: [
          {
            localName: `mortgage:${loan.id}:propertyValue`,
            remoteAccountId: "ynab-prop",
            syncDirection: "pull",
          },
        ],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    expect(result.report).toHaveLength(1);
    expect(result.report[0]!.status).toBe("migrated_mortgage");

    // Verify the mapping was updated with typed fields
    const conns = db.select().from(schema.apiConnections).all();
    const ynab = conns.find((r) => r.service === "ynab");
    const mapping = ynab?.accountMappings?.[0];
    expect(mapping?.localId).toBe(`mortgage:${loan.id}:propertyValue`);
    expect(mapping?.loanId).toBe(loan.id);
    expect(mapping?.loanMapType).toBe("propertyValue");
  });

  it("migrates asset localName to assetId", async () => {
    // Create an asset item
    db.insert(schema.otherAssetItems)
      .values({ name: "Gold Bars", year: 2026, value: "50000" })
      .run();

    // Update connection with legacy asset mapping
    db.delete(schema.apiConnections).run();
    db.insert(schema.apiConnections)
      .values({
        service: "actual",
        config: { serverUrl: "http://localhost" },
        accountMappings: [
          {
            localName: "Gold Bars",
            remoteAccountId: "actual-gold",
            syncDirection: "pull",
          },
        ],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    const assetReport = result.report.find(
      (r) => r.status === "migrated_asset",
    );
    expect(assetReport).toBeDefined();
    expect(assetReport!.mapping).toBe("Gold Bars");

    // Verify typed fields
    const conns = db.select().from(schema.apiConnections).all();
    const actual = conns.find((r) => r.service === "actual");
    const mapping = actual?.accountMappings?.[0];
    expect(mapping?.localId).toMatch(/^asset:\d+$/);
    expect(mapping?.assetId).toBeGreaterThan(0);
  });

  it("reports already_migrated for mappings with localId", async () => {
    db.delete(schema.apiConnections).run();
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        accountMappings: [
          {
            localId: "asset:1",
            localName: "Already Done",
            remoteAccountId: "r-1",
            syncDirection: "pull",
            assetId: 1,
          },
        ],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    expect(result.report).toHaveLength(1);
    expect(result.report[0]!.status).toBe("already_migrated");
  });

  it("reports unresolved for unmapped localName", async () => {
    db.delete(schema.apiConnections).run();
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        accountMappings: [
          {
            localName: "Unknown Thing",
            remoteAccountId: "r-1",
            syncDirection: "pull",
          },
        ],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    expect(result.report).toHaveLength(1);
    expect(result.report[0]!.status).toBe("unresolved");
  });

  it("migrates portfolio label to performanceAccountId", async () => {
    // Create a performance account with a known label
    const perfId = seedPerformanceAccount(db, {
      name: "Vanguard 401k",
      institution: "Vanguard",
      accountLabel: "Vanguard 401k",
    });

    db.delete(schema.apiConnections).run();
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        accountMappings: [
          {
            localName: "Vanguard 401k",
            remoteAccountId: "ynab-401k",
            syncDirection: "push",
          },
        ],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    const portfolioReport = result.report.find(
      (r) => r.status === "migrated_portfolio",
    );
    expect(portfolioReport).toBeDefined();

    // Verify typed fields
    const conns = db.select().from(schema.apiConnections).all();
    const ynab = conns.find((r) => r.service === "ynab");
    const mapping = ynab?.accountMappings?.[0];
    expect(mapping?.localId).toBe(`performance:${perfId}`);
    expect(mapping?.performanceAccountId).toBe(perfId);
  });

  it("skips connections with no mappings", async () => {
    db.delete(schema.apiConnections).run();
    db.insert(schema.apiConnections)
      .values({
        service: "ynab",
        config: { apiKey: "test" },
        accountMappings: [],
      })
      .run();

    const result = await caller.sync.migrateAccountMappingsToIds();
    expect(result.report).toEqual([]);
  });
});
