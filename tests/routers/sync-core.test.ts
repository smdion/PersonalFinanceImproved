/**
 * Sync core router integration tests.
 *
 * Tests syncAll, getPreview, and computeExpenseComparison procedures.
 * External API calls are mocked — only DB-level logic is exercised.
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
  seedBudgetProfile,
  seedBudgetItem,
  seedSavingsGoal,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

// Keep references to mocks so we can adjust per test
const mockGetActiveBudgetApi = vi.fn().mockResolvedValue("none");
const mockGetClientForService = vi.fn().mockResolvedValue(null);
const mockGetApiConnection = vi.fn().mockResolvedValue(null);
const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: (...args: unknown[]) => mockGetActiveBudgetApi(...args),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  getClientForService: (...args: unknown[]) => mockGetClientForService(...args),
  getApiConnection: (...args: unknown[]) => mockGetApiConnection(...args),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  YNAB_EXPENSE_EXCLUDED_CATEGORIES: new Set([
    "Split",
    "Inflow: Ready to Assign",
    "Uncategorized",
  ]),
}));

// ── syncAll ──────────────────────────────────────────────────────────

describe("sync core — syncAll", () => {
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
    mockCacheSet.mockResolvedValue(undefined);
  });

  it("throws PRECONDITION_FAILED when no client is configured", async () => {
    await expect(caller.sync.syncAll({ service: "ynab" })).rejects.toThrow(
      /No ynab connection configured/,
    );
  });

  it("throws PRECONDITION_FAILED for actual when no client", async () => {
    await expect(caller.sync.syncAll({ service: "actual" })).rejects.toThrow(
      /No actual connection configured/,
    );
  });

  // The syncAll happy-path tests below were converted to .skip in v0.5
  // when C3 (atomic sync writes) wrapped the sync body in
  // ctx.db.transaction(async (tx) => ...). better-sqlite3 only supports
  // SYNCHRONOUS transactions ("Transaction function cannot return a
  // promise") so the integration path can't run under SQLite. Same
  // pattern as the existing finalizeYear pure-function tests in
  // performance-coverage.test.ts. Production behavior is verified by
  // the PG-backed deploy smoke tests + the unit tests of the helpers.
  it.skip("syncs accounts, categories, and transactions successfully", async () => {
    // Insert a connection row so lastSyncedAt update works
    db.insert(schema.apiConnections)
      .values({ service: "ynab", config: { apiKey: "test" } })
      .run();

    const mockClient = {
      getAccounts: vi.fn().mockResolvedValue([
        {
          id: "acct-1",
          name: "Checking",
          balance: 5000,
          onBudget: true,
          closed: false,
          type: "checking",
        },
        {
          id: "acct-2",
          name: "Savings",
          balance: 10000,
          onBudget: true,
          closed: false,
          type: "savings",
        },
      ]),
      getCategories: vi.fn().mockResolvedValue([
        {
          id: "group-1",
          name: "Essentials",
          hidden: false,
          categories: [
            { id: "cat-1", name: "Rent", hidden: false },
            { id: "cat-2", name: "Groceries", hidden: false },
          ],
        },
      ]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([
        {
          id: "tx-1",
          date: "2026-01-15",
          amount: -50,
          categoryName: "Groceries",
          deleted: false,
        },
      ]),
    };

    mockGetClientForService.mockResolvedValue(mockClient);
    mockGetApiConnection.mockResolvedValue({ accountMappings: [] });

    const result = await caller.sync.syncAll({ service: "ynab" });
    expect(result.success).toBe(true);
    expect(result.counts.accounts).toBe(2);
    expect(result.counts.categories).toBe(2);
    expect(result.counts.transactions).toBe(1);
    expect(result.counts.assetsPulled).toBe(0);

    // Verify cacheSet was called for each data type
    expect(mockCacheSet).toHaveBeenCalledTimes(4);
  });

  it.skip("pulls asset values from tracking accounts during sync", async () => {
    // Insert an asset for pull mapping
    db.insert(schema.otherAssetItems)
      .values({ name: "Vehicle", year: 2026, value: "20000" })
      .run();

    const assetRow = db.select().from(schema.otherAssetItems).all()[0]!;

    const mockClient = {
      getAccounts: vi.fn().mockResolvedValue([
        {
          id: "track-1",
          name: "Car Value",
          balance: 22000,
          onBudget: false,
          closed: false,
          type: "otherAsset",
        },
      ]),
      getCategories: vi.fn().mockResolvedValue([]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
    };

    mockGetClientForService.mockResolvedValue(mockClient);
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `asset:${assetRow.id}`,
          localName: "Vehicle",
          remoteAccountId: "track-1",
          syncDirection: "pull",
          assetId: assetRow.id,
        },
      ],
    });

    const result = await caller.sync.syncAll({ service: "ynab" });
    expect(result.success).toBe(true);
    expect(result.counts.assetsPulled).toBe(1);

    // Verify asset was updated
    const assets = db.select().from(schema.otherAssetItems).all();
    const updated = assets.find((a) => a.name === "Vehicle" && a.year === 2026);
    expect(updated?.value).toBe("22000");
  });

  it.skip("pulls mortgage property value from tracking account", async () => {
    db.insert(schema.mortgageLoans)
      .values({
        name: "Home",
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

    const mockClient = {
      getAccounts: vi.fn().mockResolvedValue([
        {
          id: "track-prop",
          name: "Home Value",
          balance: 420000,
          onBudget: false,
          closed: false,
          type: "otherAsset",
        },
      ]),
      getCategories: vi.fn().mockResolvedValue([]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
    };

    mockGetClientForService.mockResolvedValue(mockClient);
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `mortgage:${loan.id}:propertyValue`,
          localName: "Home — Property Value",
          remoteAccountId: "track-prop",
          syncDirection: "pull",
          loanId: loan.id,
          loanMapType: "propertyValue",
        },
      ],
    });

    const result = await caller.sync.syncAll({ service: "ynab" });
    expect(result.success).toBe(true);
    expect(result.counts.assetsPulled).toBe(1);

    const loans = db.select().from(schema.mortgageLoans).all();
    const updated = loans.find((l) => l.id === loan.id);
    expect(updated?.propertyValueEstimated).toBe("420000");
    expect(updated?.usePurchaseOrEstimated).toBe("estimated");
  });

  it.skip("pulls mortgage loan balance from tracking account", async () => {
    const loans = db.select().from(schema.mortgageLoans).all();
    const loan = loans[0]!;

    const mockClient = {
      getAccounts: vi.fn().mockResolvedValue([
        {
          id: "track-loan",
          name: "Mortgage",
          balance: -285000,
          onBudget: false,
          closed: false,
          type: "mortgage",
        },
      ]),
      getCategories: vi.fn().mockResolvedValue([]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
    };

    mockGetClientForService.mockResolvedValue(mockClient);
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [
        {
          localId: `mortgage:${loan.id}:loanBalance`,
          localName: "Home — Loan Balance",
          remoteAccountId: "track-loan",
          syncDirection: "pull",
          loanId: loan.id,
          loanMapType: "loanBalance",
        },
      ],
    });

    const result = await caller.sync.syncAll({ service: "ynab" });
    expect(result.success).toBe(true);
    expect(result.counts.assetsPulled).toBe(1);

    const updatedLoans = db.select().from(schema.mortgageLoans).all();
    const updated = updatedLoans.find((l) => l.id === loan.id);
    expect(updated?.apiBalance).toBe("285000"); // absolute value
  });

  it("wraps client errors in INTERNAL_SERVER_ERROR", async () => {
    const mockClient = {
      getAccounts: vi.fn().mockRejectedValue(new Error("API rate limited")),
      getCategories: vi.fn().mockResolvedValue([]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
    };
    mockGetClientForService.mockResolvedValue(mockClient);

    await expect(caller.sync.syncAll({ service: "ynab" })).rejects.toThrow(
      /Sync failed: API rate limited/,
    );
  });
});

// ── getPreview ───────────────────────────────────────────────────────

describe("sync core — getPreview", () => {
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

  it("returns synced:false when no cache exists", async () => {
    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(false);
  });

  it("returns synced:false when no connection exists", async () => {
    // Cache exists but no connection
    mockCacheGet.mockResolvedValue({
      data: [
        {
          id: "a1",
          name: "Checking",
          balance: 1000,
          onBudget: true,
          closed: false,
          type: "checking",
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(false);
  });

  it("returns full preview when cache and connection exist", async () => {
    // Seed some local data
    const profileId = await seedBudgetProfile(db, "Preview Profile");
    seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Rent",
      amounts: [2000],
    });
    seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Groceries",
      amounts: [600],
    });
    seedSavingsGoal(db, { name: "Vacation Fund" });

    // Mock cache to return accounts and categories
    const mockAccounts = [
      {
        id: "a1",
        name: "Checking",
        balance: 5000,
        onBudget: true,
        closed: false,
        type: "checking",
      },
      {
        id: "a2",
        name: "Invest Track",
        balance: 50000,
        onBudget: false,
        closed: false,
        type: "investmentAccount",
      },
    ];
    const mockCategories = [
      {
        id: "g1",
        name: "Essentials",
        hidden: false,
        categories: [
          { id: "c1", name: "Rent", hidden: false },
          { id: "c2", name: "Groceries", hidden: false },
        ],
      },
      {
        id: "g2",
        name: "Lifestyle",
        hidden: false,
        categories: [{ id: "c3", name: "Dining", hidden: false }],
      },
    ];

    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => {
        if (key === "accounts")
          return { data: mockAccounts, fetchedAt: new Date() };
        if (key === "categories")
          return { data: mockCategories, fetchedAt: new Date() };
        return null;
      },
    );

    mockGetApiConnection.mockResolvedValue({
      accountMappings: [],
      skippedCategoryIds: [],
      linkedProfileId: profileId,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);

    if (!result.synced) throw new Error("Expected synced:true");

    // Cash
    expect(result.cash.api).toBe(5000);
    expect(result.cash.apiAccounts).toHaveLength(1);
    expect(result.cash.apiAccounts[0]!.name).toBe("Checking");

    // Accounts
    expect(result.accounts.total).toBe(2);
    expect(result.accounts.onBudget).toBe(1);
    expect(result.accounts.tracking).toBe(1);

    // Categories
    expect(result.categories.groups).toBe(2);
    expect(result.categories.total).toBe(3);

    // Budget matching — Rent and Groceries should be "suggested" by fuzzy match
    expect(result.budget.matches.length).toBeGreaterThanOrEqual(2);
    const rentMatch = result.budget.matches.find((m) => m.ledgrName === "Rent");
    expect(rentMatch).toBeDefined();
    expect(rentMatch!.status).toBe("suggested");
    expect(rentMatch!.apiCategoryName).toBe("Rent");

    // Savings matching — Vacation Fund should be unmatched (no API category named that)
    const vacMatch = result.savings.matches.find(
      (m) => m.goalName === "Vacation Fund",
    );
    expect(vacMatch).toBeDefined();
    expect(vacMatch!.status).toBe("unmatched");

    // Unmatched API categories — Dining has no Ledgr match
    const diningUnmatched = result.budget.unmatchedApiCategories.find(
      (c) => c.name === "Dining",
    );
    expect(diningUnmatched).toBeDefined();

    // Portfolio tracking accounts
    expect(result.portfolio.trackingAccounts).toHaveLength(1);
    expect(result.portfolio.trackingAccounts[0]!.name).toBe("Invest Track");
  });

  it("shows linked budget items with their API category", async () => {
    // Seed a budget item that's already linked to an API category
    const profiles = db.select().from(schema.budgetProfiles).all();
    const profileId = profiles[0]!.id;

    seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Insurance",
      amounts: [300],
      apiCategoryId: "c-insurance",
      apiCategoryName: "Insurance",
      apiSyncDirection: "pull",
    });

    const mockAccounts = [
      {
        id: "a1",
        name: "Checking",
        balance: 5000,
        onBudget: true,
        closed: false,
        type: "checking",
      },
    ];
    const mockCategories = [
      {
        id: "g1",
        name: "Essentials",
        hidden: false,
        categories: [
          { id: "c-insurance", name: "Insurance", hidden: false },
          { id: "c-rent", name: "Rent", hidden: false },
          { id: "c-groceries", name: "Groceries", hidden: false },
        ],
      },
    ];

    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => {
        if (key === "accounts")
          return { data: mockAccounts, fetchedAt: new Date() };
        if (key === "categories")
          return { data: mockCategories, fetchedAt: new Date() };
        return null;
      },
    );

    mockGetApiConnection.mockResolvedValue({
      accountMappings: [],
      skippedCategoryIds: [],
      linkedProfileId: profileId,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    const insuranceMatch = result.budget.matches.find(
      (m) => m.ledgrName === "Insurance",
    );
    expect(insuranceMatch).toBeDefined();
    expect(insuranceMatch!.status).toBe("linked");
    expect(insuranceMatch!.apiCategoryId).toBe("c-insurance");
    expect(insuranceMatch!.syncDirection).toBe("pull");
  });

  it("skipped categories appear in skippedApiCategories", async () => {
    const mockAccounts = [
      {
        id: "a1",
        name: "Checking",
        balance: 5000,
        onBudget: true,
        closed: false,
        type: "checking",
      },
    ];
    const mockCategories = [
      {
        id: "g1",
        name: "Internal",
        hidden: false,
        categories: [{ id: "c-skip", name: "Hidden Transfer", hidden: false }],
      },
    ];

    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => {
        if (key === "accounts")
          return { data: mockAccounts, fetchedAt: new Date() };
        if (key === "categories")
          return { data: mockCategories, fetchedAt: new Date() };
        return null;
      },
    );

    const profiles = db.select().from(schema.budgetProfiles).all();
    const profileId = profiles[0]!.id;

    mockGetApiConnection.mockResolvedValue({
      accountMappings: [],
      skippedCategoryIds: ["c-skip"],
      linkedProfileId: profileId,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    expect(result.budget.skippedApiCategories).toHaveLength(1);
    expect(result.budget.skippedApiCategories[0]!.id).toBe("c-skip");
    expect(result.budget.unmatchedApiCategories).toHaveLength(0);
  });
});

// ── computeExpenseComparison ─────────────────────────────────────────

describe("sync core — computeExpenseComparison", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockCacheGet.mockResolvedValue(null);
  });

  const dateRange = {
    currentStart: "2026-03-01",
    currentEnd: "2026-03-31",
    priorStart: "2026-02-01",
    priorEnd: "2026-02-28",
  };

  it("returns empty categories when no API is active", async () => {
    const result = await caller.sync.computeExpenseComparison(dateRange);
    expect(result.categories).toEqual([]);
    expect(result.service).toBeNull();
  });

  it("returns empty categories when no cached transactions", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue(null);

    const result = await caller.sync.computeExpenseComparison(dateRange);
    expect(result.categories).toEqual([]);
    expect(result.service).toBe("ynab");
  });

  it("groups transactions by category and period", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [
        {
          id: "t1",
          date: "2026-03-10",
          amount: -100,
          categoryName: "Groceries",
          deleted: false,
        },
        {
          id: "t2",
          date: "2026-03-15",
          amount: -50,
          categoryName: "Groceries",
          deleted: false,
        },
        {
          id: "t3",
          date: "2026-02-10",
          amount: -80,
          categoryName: "Groceries",
          deleted: false,
        },
        {
          id: "t4",
          date: "2026-03-05",
          amount: -200,
          categoryName: "Dining",
          deleted: false,
        },
        {
          id: "t5",
          date: "2026-02-20",
          amount: -150,
          categoryName: "Dining",
          deleted: false,
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.computeExpenseComparison(dateRange);
    expect(result.service).toBe("ynab");
    expect(result.categories.length).toBe(2);

    // Categories sorted by |current| descending: Dining(-200) then Groceries(-150)
    const dining = result.categories.find((c) => c.name === "Dining")!;
    expect(dining.current).toBe(-200);
    expect(dining.prior).toBe(-150);
    expect(dining.diff).toBe(-50); // current - prior

    const groceries = result.categories.find((c) => c.name === "Groceries")!;
    expect(groceries.current).toBe(-150); // -100 + -50
    expect(groceries.prior).toBe(-80);
  });

  it("excludes deleted transactions and those without category", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [
        {
          id: "t1",
          date: "2026-03-10",
          amount: -100,
          categoryName: "Groceries",
          deleted: false,
        },
        {
          id: "t2",
          date: "2026-03-15",
          amount: -50,
          categoryName: "Groceries",
          deleted: true,
        },
        {
          id: "t3",
          date: "2026-03-20",
          amount: -75,
          categoryName: null,
          deleted: false,
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.computeExpenseComparison(dateRange);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]!.current).toBe(-100);
  });

  it("excludes transactions outside both date ranges", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [
        {
          id: "t1",
          date: "2026-01-10",
          amount: -100,
          categoryName: "Groceries",
          deleted: false,
        },
        {
          id: "t2",
          date: "2026-03-10",
          amount: -50,
          categoryName: "Groceries",
          deleted: false,
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.computeExpenseComparison(dateRange);
    expect(result.categories).toHaveLength(1);
    // Only the March transaction counts
    expect(result.categories[0]!.current).toBe(-50);
    expect(result.categories[0]!.prior).toBe(0);
  });

  it("computes pctChange correctly, null when prior is zero", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [
        {
          id: "t1",
          date: "2026-03-10",
          amount: -200,
          categoryName: "NewCat",
          deleted: false,
        },
        {
          id: "t2",
          date: "2026-03-10",
          amount: -100,
          categoryName: "OldCat",
          deleted: false,
        },
        {
          id: "t3",
          date: "2026-02-10",
          amount: -100,
          categoryName: "OldCat",
          deleted: false,
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await caller.sync.computeExpenseComparison(dateRange);
    const newCat = result.categories.find((c) => c.name === "NewCat")!;
    expect(newCat.pctChange).toBeNull(); // prior is 0

    const oldCat = result.categories.find((c) => c.name === "OldCat")!;
    expect(oldCat.pctChange).toBe(0); // same amount: (-100 - -100) / |-100| * 100 = 0
  });
});
