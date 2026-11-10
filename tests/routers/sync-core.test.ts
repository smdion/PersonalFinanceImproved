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
  afterEach,
} from "vitest";
import fs from "node:fs";
import { TRPCError } from "@trpc/server";
import {
  ActualClient,
  resetActualWrapperGates,
} from "@/lib/budget-api/actual-client";
import { appRouter } from "@/server/routers";
import {
  createTestCaller,
  seedBudgetProfile,
  seedBudgetItem,
  seedSavingsGoal,
  seedPerson,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { YnabClient } from "@/lib/budget-api/ynab-client";
import { ynabCategory, ynabTransaction } from "../fixtures/ynab-spec";

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

  // The syncAll happy-path tests below run under the test harness's
  // db.transaction monkey-patch (see tests/routers/setup.ts) which
  // routes async transaction callbacks through the outer db instance.
  // The patch bypasses atomicity — production uses PG transactions
  // which are exercised by the deploy smoke tests — but the logic
  // inside the transaction block is still driven end-to-end here.
  it("syncs accounts, categories, and transactions successfully", async () => {
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
    expect(result.ok).toBe(true);
    expect(result.counts.accounts).toBe(2);
    expect(result.counts.categories).toBe(2);
    expect(result.counts.transactions).toBe(1);
    expect(result.counts.assetsPulled).toBe(0);

    // Verify cacheSet was called for each data type
    expect(mockCacheSet).toHaveBeenCalledTimes(4);
  });

  it("reads the active budget app through the sync's transaction, not the outer connection", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockGetClientForService.mockResolvedValue({
      getAccounts: vi.fn().mockResolvedValue([]),
      getCategories: vi.fn().mockResolvedValue([]),
      getMonthDetail: vi.fn().mockResolvedValue({ categories: [] }),
      getTransactions: vi.fn().mockResolvedValue([]),
    });
    mockGetApiConnection.mockResolvedValue({ accountMappings: [] });
    const readers: unknown[] = [];
    mockCacheSet.mockImplementation((tx: unknown) => {
      readers.push(tx);
      return Promise.resolve();
    });

    const result = await caller.sync.syncAll({ service: "ynab" });
    expect(result.ok).toBe(true);
    const transaction = readers[0];
    expect(transaction).toBeDefined();
    expect(transaction).not.toBe(db);
    expect(mockGetActiveBudgetApi.mock.calls.at(-1)?.[0]).toBe(transaction);
  });

  it("pulls asset values from tracking accounts during sync", async () => {
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
    expect(result.ok).toBe(true);
    expect(result.counts.assetsPulled).toBe(1);

    // Verify asset was updated
    const assets = db.select().from(schema.otherAssetItems).all();
    const updated = assets.find((a) => a.name === "Vehicle" && a.year === 2026);
    expect(updated?.value).toBe("22000");
  });

  it("pulls mortgage property value from tracking account", async () => {
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
    expect(result.ok).toBe(true);
    expect(result.counts.assetsPulled).toBe(1);

    const loans = db.select().from(schema.mortgageLoans).all();
    const updated = loans.find((l) => l.id === loan.id);
    expect(updated?.propertyValueEstimated).toBe("420000");
    // The value only: which one to use is the household's choice.
    expect(updated?.usePurchaseOrEstimated).toBe("purchase");
  });

  it("pulls mortgage loan balance from tracking account", async () => {
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
    expect(result.ok).toBe(true);
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

  /** The real Actual client over a stand-in wrapper answering with the
   *  recorded responses, one of them broken. */
  describe("an Actual answer Ledgr can't read", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reshaping recorded JSON
    type Body = any;
    const recorded = (name: string) =>
      structuredClone(
        JSON.parse(
          fs.readFileSync(`tests/fixtures/actual-wrapper/${name}.json`, "utf8"),
        ).bodies,
      ) as Body[];
    afterEach(() => vi.unstubAllGlobals());

    it.each([
      [
        "a nested balance",
        "balance",
        (b: Body) => ({ data: { balance: b.data } }),
        "data",
      ],
      [
        "a renamed offbudget",
        "accounts",
        (b: Body) => {
          for (const a of b.data) {
            a.off_budget = a.offbudget;
            delete a.offbudget;
          }
          return b;
        },
        "data.0.offbudget",
      ],
      [
        "a renamed transaction amount",
        "transactions",
        () => ({
          data: [
            {
              id: "t1",
              account: "a1",
              date: "2026-11-01",
              amout: -100,
              cleared: false,
              reconciled: false,
              subtransactions: [],
            },
          ],
        }),
        "data.0.amount",
      ],
      [
        "renamed categoryGroups",
        "month",
        (b: Body) => {
          b.data.groups = b.data.categoryGroups;
          delete b.data.categoryGroups;
          return b;
        },
        "data.categoryGroups",
      ],
      [
        "a renamed category name",
        "categories",
        (b: Body) => {
          for (const c of b.data) {
            c.title = c.name;
            delete c.name;
          }
          return b;
        },
        "data.0.name",
      ],
      ["a payee list that isn't one", "payees", () => ({ data: {} }), "data"],
    ])(
      "%s fails the sync, names the field, and changes nothing",
      async (_name, broken, breakIt, field) => {
        resetActualWrapperGates();
        const bodies = {
          accounts: recorded("accounts")[0],
          balance: { data: 123456 },
          "category-groups": recorded("category-groups")[0],
          categories: recorded("categories")[0],
          month: recorded("month")[0],
          note: { data: "" },
          payees: { data: [] },
          transactions: { data: [] },
        } as Record<string, unknown>;
        bodies[broken] = breakIt(bodies[broken]);
        const route = (url: string) =>
          url.includes("/balance")
            ? "balance"
            : url.includes("/transactions")
              ? "transactions"
              : url.includes("/notes/")
                ? "note"
                : url.includes("/months/")
                  ? "month"
                  : url.endsWith("/categorygroups")
                    ? "category-groups"
                    : url.endsWith("/categories")
                      ? "categories"
                      : url.endsWith("/payees")
                        ? "payees"
                        : "accounts";
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string) => {
            const body = bodies[route(url)];
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify(body),
              json: async () => body,
            };
          }),
        );
        mockGetClientForService.mockResolvedValue(
          new ActualClient("http://actual.local", "key", "sync-id"),
        );
        const tables = [
          schema.otherAssetItems,
          schema.mortgageLoans,
          schema.debts,
          schema.savingsMonthly,
          schema.portfolioAccounts,
          schema.apiConnections,
        ];
        const before = tables.map((t) => db.select().from(t).all());

        const error = await caller.sync.syncAll({ service: "actual" }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(TRPCError);
        const { data } = appRouter._def._config.errorFormatter({
          shape: {
            message: "",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
          error: error as TRPCError,
          type: "mutation",
          path: "sync.syncAll",
          input: undefined,
          ctx: undefined,
        }) as { data: { externalError: unknown; userMessage: string } };
        expect(data.externalError).toEqual({
          service: "Actual",
          code: "bad-response",
          field,
        });
        expect(data.userMessage).toBe(
          `Actual sent something Ledgr doesn't understand (${field}). Nothing was changed.`,
        );
        expect(tables.map((t) => db.select().from(t).all())).toEqual(before);
        expect(mockCacheSet).not.toHaveBeenCalled();
      },
    );
  });

  it.each(["actual", "ynab"] as const)(
    "a %s error answer's body reaches neither the client nor the log",
    async (service) => {
      resetActualWrapperGates();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("SECRET-BODY echoing the key", { status: 400 }),
        ),
      );
      mockGetClientForService.mockResolvedValue(
        service === "actual"
          ? new ActualClient("http://actual.local", "key", "sync-id")
          : new YnabClient("token", "budget-id"),
      );
      const logged = vi.spyOn(console, "error");
      const error = await caller.sync.syncAll({ service }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).message).toMatch(/^Sync failed: /);
      expect((error as TRPCError).message).not.toContain("SECRET-BODY");
      const lines = logged.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("sync_failed"))).toBe(true);
      expect(lines.join("\n")).not.toContain("SECRET-BODY");
      logged.mockRestore();
    },
  );
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

    const insuranceItemId = seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Insurance",
      amounts: [300],
    });
    db.insert(schema.budgetItemCategoryLinks)
      .values({
        budgetItemId: insuranceItemId,
        service: "ynab",
        categoryId: "c-insurance",
        categoryName: "Insurance",
        syncDirection: "pull",
      })
      .run();

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

  // Found live, 2026-08-31: a household's Actual budget was rebuilt/
  // re-imported upstream, which regenerates every category's internal id
  // while keeping its name and balance — every stored apiCategoryId in
  // Ledgr went stale at once. This previously still reported "linked"
  // (the check only asked "is some id stored," never "does it still
  // resolve"), so a push silently wrote to a category that no longer
  // existed while the UI claimed everything was fine.
  it("reports a budget item as orphaned, not linked, when its stored category id no longer resolves", async () => {
    const profiles = db.select().from(schema.budgetProfiles).all();
    const profileId = profiles[0]!.id;

    const orphanedItemId = seedBudgetItem(db, profileId, {
      category: "Essentials",
      subcategory: "Orphaned Insurance",
      amounts: [300],
    });
    db.insert(schema.budgetItemCategoryLinks)
      .values({
        budgetItemId: orphanedItemId,
        service: "ynab",
        categoryId: "c-insurance-old-stale-id",
        categoryName: "Insurance",
        syncDirection: "pull",
      })
      .run();

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
    // The current category list has an "Insurance" category, but under a
    // DIFFERENT id than what's stored — simulating a rebuilt budget.
    const mockCategories = [
      {
        id: "g1",
        name: "Essentials",
        hidden: false,
        categories: [
          { id: "c-insurance-new-id", name: "Insurance", hidden: false },
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
      (m) => m.ledgrName === "Orphaned Insurance",
    );
    expect(insuranceMatch).toBeDefined();
    expect(insuranceMatch!.status).toBe("orphaned");
    expect(insuranceMatch!.apiCategoryId).toBe("c-insurance-old-stale-id");
    expect(result.budget.summary.orphaned).toBeGreaterThanOrEqual(1);
  });

  it("reports a savings goal as orphaned, not linked, when its stored category id no longer resolves", async () => {
    const carGoalId = seedSavingsGoal(db, { name: "Car" });
    db.insert(schema.savingsGoalCategoryLinks)
      .values({
        savingsGoalId: carGoalId,
        service: "ynab",
        role: "primary",
        categoryId: "c-car-old-stale-id",
        categoryName: "Car",
      })
      .run();

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
        name: "Sinking Funds",
        hidden: false,
        categories: [{ id: "c-car-new-id", name: "Car", hidden: false }],
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
      linkedProfileId: null,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    const carMatch = result.savings.matches.find((m) => m.goalName === "Car");
    expect(carMatch).toBeDefined();
    expect(carMatch!.status).toBe("orphaned");
    expect(carMatch!.apiCategoryId).toBe("c-car-old-stale-id");
    expect(carMatch!.apiBalance).toBeNull();
    expect(result.savings.summary.orphaned).toBeGreaterThanOrEqual(1);
  });

  // Found live, 2026-08-31: this preview's cash figure was an independent
  // duplicate of getEffectiveCash's type-based auto-detection, so mapping
  // "Cash" accounts on the Integrations page (server/services/budget/account-balances.ts's
  // sumMappedAccountBalances) fixed Net Worth/Assets but this preview kept
  // showing $0 — a second, differently-computed number for the same thing.
  it("uses mapped Cash accounts for the preview total when mappings exist, ignoring type", async () => {
    const mockAccounts = [
      // No recognizable "type" at all — matches Actual's real account
      // shape (no account-type field exists there), which is exactly why
      // type-based detection alone can't work for this household.
      { id: "acct-checking", name: "BCU Checking", balance: 21112.06 },
      { id: "acct-hysa", name: "Vanguard HYSA", balance: 33623.99 },
      // Present but NOT mapped to cash — must be excluded from the total.
      { id: "acct-other", name: "Unrelated", balance: 999999 },
    ];
    const mockCategories: {
      id: string;
      name: string;
      hidden: boolean;
      categories: unknown[];
    }[] = [];

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
      accountMappings: [
        {
          localId: "cash",
          localName: "Cash",
          remoteAccountId: "acct-checking",
          syncDirection: "pull",
        },
        {
          localId: "cash",
          localName: "Cash",
          remoteAccountId: "acct-hysa",
          syncDirection: "pull",
        },
      ],
      skippedCategoryIds: [],
      linkedProfileId: null,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "actual" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    expect(result.cash.api).toBeCloseTo(21112.06 + 33623.99, 2);
    expect(result.cash.apiAccounts).toHaveLength(2);
    expect(result.cash.apiAccounts.map((a) => a.name).sort()).toEqual([
      "BCU Checking",
      "Vanguard HYSA",
    ]);
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

  it("portfolio.localAccounts gives each owner of a jointly-tracked account a distinct label and ownerPersonId, not both 'Joint'", async () => {
    const alex = await seedPerson(db, "Alex", "1987-01-01");
    const sam = await seedPerson(db, "Sam", "1991-01-01");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "ira",
      accountLabel: "IRA (Vanguard)",
      ownershipType: "joint",
      ownerPersonId: null,
    });
    seedSnapshot(db, "2026-01-15", [
      {
        performanceAccountId: perfAcctId,
        amount: "50000",
        institution: "Vanguard",
        accountType: "ira",
        ownerPersonId: alex,
      },
      {
        performanceAccountId: perfAcctId,
        amount: "40000",
        institution: "Vanguard",
        accountType: "ira",
        ownerPersonId: sam,
      },
    ]);

    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => {
        if (key === "accounts")
          return {
            data: [
              {
                id: "a1",
                name: "Tracking",
                balance: 0,
                onBudget: false,
                closed: false,
                type: "investmentAccount",
              },
            ],
            fetchedAt: new Date(),
          };
        if (key === "categories") return { data: [], fetchedAt: new Date() };
        return null;
      },
    );
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [],
      skippedCategoryIds: [],
      linkedProfileId: null,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    const localAccounts = result.portfolio!.localAccounts;
    expect(localAccounts).toHaveLength(2);
    const labels = localAccounts.map((a) => a.label).sort();
    expect(labels).toEqual(["Alex IRA (Vanguard)", "Sam IRA (Vanguard)"]);
    const ownerIds = localAccounts.map((a) => a.ownerPersonId).sort();
    expect(ownerIds).toEqual([alex, sam].sort());
  });

  it("portfolio.localAccounts still gives each owner a distinct label even when the shared account has a displayName set", async () => {
    const alex = await seedPerson(db, "Alex2", "1987-01-01");
    const sam = await seedPerson(db, "Sam2", "1991-01-01");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "ira",
      accountLabel: "IRA (Fidelity)",
      displayName: "Retirement IRA",
      ownershipType: "joint",
      ownerPersonId: null,
    });
    seedSnapshot(db, "2026-01-16", [
      {
        performanceAccountId: perfAcctId,
        amount: "10000",
        institution: "Fidelity",
        accountType: "ira",
        ownerPersonId: alex,
      },
      {
        performanceAccountId: perfAcctId,
        amount: "20000",
        institution: "Fidelity",
        accountType: "ira",
        ownerPersonId: sam,
      },
    ]);

    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => {
        if (key === "accounts") return { data: [], fetchedAt: new Date() };
        if (key === "categories") return { data: [], fetchedAt: new Date() };
        return null;
      },
    );
    mockGetApiConnection.mockResolvedValue({
      accountMappings: [],
      skippedCategoryIds: [],
      linkedProfileId: null,
      linkedColumnIndex: 0,
      lastSyncedAt: null,
    });

    const result = await caller.sync.getPreview({ service: "ynab" });
    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("Expected synced:true");

    const localAccounts = result.portfolio!.localAccounts.filter(
      (a) => a.ownerPersonId === alex || a.ownerPersonId === sam,
    );
    expect(localAccounts).toHaveLength(2);
    // displayName wins in accountDisplayName's own priority order — this
    // is a known, documented limitation (see portfolio-labels.ts), not
    // something this fix claims to solve. Asserting it explicitly so a
    // regression here is caught rather than silently reintroducing the
    // duplicate-key crash for accounts with a displayName set.
    const labels = localAccounts.map((a) => a.label);
    expect(labels.every((l) => l === "Retirement IRA")).toBe(true);
    // The React key/identity fix still holds even though the labels
    // collide, because it's keyed on (performanceAccountId, ownerPersonId),
    // not on the label.
    const ownerIds = localAccounts.map((a) => a.ownerPersonId).sort();
    expect(ownerIds).toEqual([alex, sam].sort());
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
    expect(newCat.percentChange).toBeNull(); // prior is 0

    const oldCat = result.categories.find((c) => c.name === "OldCat")!;
    expect(oldCat.percentChange).toBe(0); // same amount: (-100 - -100) / |-100| * 100 = 0
  });

  /** A stand-in for each service's API; `body(url)` answers each request. */
  function standIn(body: (url: string) => unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const b = body(url);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(b),
          json: async () => b,
        };
      }),
    );
  }

  /** What a sync caches, from the real client, compared month over month. */
  async function compareOverClient(
    service: "actual" | "ynab",
    client: ActualClient | YnabClient,
  ) {
    const cached = {
      transactions: await client.getTransactions("2025-01-01"),
      categories: await client.getCategories(new Date()),
    };
    // Viewing the comparison asks the budget app for nothing.
    vi.unstubAllGlobals();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockGetActiveBudgetApi.mockResolvedValue(service);
    mockGetClientForService.mockResolvedValue(client);
    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => ({
        data: cached[key as keyof typeof cached],
        fetchedAt: new Date(),
      }),
    );
    try {
      return await caller.sync.computeExpenseComparison({
        currentStart: "2026-11-01",
        currentEnd: "2026-11-30",
        priorStart: "2026-10-01",
        priorEnd: "2026-10-31",
      });
    } finally {
      vi.unstubAllGlobals();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  }

  it("compares expense categories on Actual, named from its list, income left out", async () => {
    resetActualWrapperGates();
    const recorded = (name: string) =>
      JSON.parse(
        fs.readFileSync(`tests/fixtures/actual-wrapper/${name}.json`, "utf8"),
      ).bodies as Array<{ data: Array<{ account: string }> }>;
    const checking = recorded("transactions")[0]!.data;
    standIn((url) =>
      url.endsWith("/accounts")
        ? recorded("accounts")[0]
        : url.endsWith("/categorygroups")
          ? recorded("category-groups")[0]
          : url.endsWith("/categories")
            ? recorded("categories")[0]
            : url.endsWith("/payees")
              ? { data: [] }
              : url.includes("/months/")
                ? recorded("month")[0]
                : url.includes("/notes/")
                  ? { data: "" }
                  : {
                      data: checking.filter((t) =>
                        url.includes(`/accounts/${t.account}/`),
                      ),
                    },
    );
    const result = await compareOverClient(
      "actual",
      new ActualClient("http://actual.local", "key", "sync-id"),
    );
    // The recorded checking account, Nov against Oct, in dollars. Its
    // October salary (Test Salary, an income category) isn't an expense.
    expect(result).toEqual({
      service: "actual",
      categories: [
        {
          name: "Test Groceries",
          current: 15.24,
          prior: 0,
          diff: 15.24,
          percentChange: null,
        },
        {
          name: "Test Dining",
          current: 0,
          prior: -1.1,
          diff: 1.1,
          percentChange: 100,
        },
        {
          name: "Test Misc",
          current: 0,
          prior: -300,
          diff: 300,
          percentChange: 100,
        },
      ],
    });
  });

  it("compares expense categories on YNAB, named as YNAB sends them, income left out", async () => {
    const group = (id: string, name: string, cats: unknown[]) => ({
      id,
      name,
      hidden: false,
      deleted: false,
      categories: cats,
    });
    const categories = {
      data: {
        server_knowledge: 1,
        category_groups: [
          group("g-internal", "Internal Master Category", [
            ynabCategory({
              id: "inflow",
              category_group_id: "g-internal",
              name: "Inflow: Ready to Assign",
            }),
          ]),
          group("g1", "Everyday", [
            ynabCategory({ id: "cat-1", name: "Groceries" }),
          ]),
        ],
      },
    };
    const tx = (id: string, date: string, amount: number, cat: string) =>
      ynabTransaction({
        id,
        date,
        amount,
        category_id: cat,
        category_name:
          cat === "inflow" ? "Inflow: Ready to Assign" : "Groceries",
      });
    standIn((url) =>
      url.endsWith("/categories")
        ? categories
        : {
            data: {
              server_knowledge: 1,
              transactions: [
                tx("y1", "2026-11-03", -42000, "cat-1"),
                tx("y2", "2026-10-03", -30000, "cat-1"),
                tx("y3", "2026-11-01", 5_000_000, "inflow"),
              ],
            },
          },
    );
    const result = await compareOverClient(
      "ynab",
      new YnabClient("token", "budget-1"),
    );
    expect(result).toEqual({
      service: "ynab",
      categories: [
        {
          name: "Groceries",
          current: -42,
          prior: -30,
          diff: -12,
          percentChange: -40,
        },
      ],
    });
  });

  it("a category list cached before groups said which hold income counts none as income", async () => {
    const tx = (id: string, categoryId: string, name: string) => ({
      id,
      date: "2026-11-05",
      amount: -10,
      categoryId,
      categoryName: name,
      deleted: false,
    });
    const cached = {
      transactions: [
        tx("t1", "c-salary", "Salary"),
        tx("t2", "c-food", "Food"),
      ],
      categories: [
        {
          id: "g1",
          name: "Income",
          hidden: true,
          categories: [{ id: "c-salary" }],
        },
        {
          id: "g2",
          name: "Usual",
          hidden: false,
          categories: [{ id: "c-food" }],
        },
      ],
    };
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockImplementation(
      async (_db: unknown, _service: unknown, key: string) => ({
        data: cached[key as keyof typeof cached],
        fetchedAt: new Date(),
      }),
    );
    const result = await caller.sync.computeExpenseComparison({
      currentStart: "2026-11-01",
      currentEnd: "2026-11-30",
      priorStart: "2026-10-01",
      priorEnd: "2026-10-31",
    });
    expect(result.categories.map((c) => c.name)).toEqual(["Salary", "Food"]);
  });
});
