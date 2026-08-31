/**
 * Budget helper coverage tests — targets uncovered lines:
 * - 37-51: getEffectiveCash with active budget API (YNAB/Actual cache hit)
 * - 107-114: getEffectiveOtherAssetsDetailed carry-forward logic (filter by year, skip zero values)
 * - 125: getEffectiveOtherAssetsDetailed return when items exist
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
  getEffectiveCash,
  getEffectiveCreditCardDebt,
  getEffectiveOtherAssets,
  getEffectiveOtherAssetsDetailed,
} from "@/server/helpers/budget";
import { createTestDb, type TestDbContext } from "./db-harness";

// Access the mocked budget-api to control return values per test
const budgetApiMock = await import("@/lib/budget-api");
const mockGetActiveBudgetApi = budgetApiMock.getActiveBudgetApi as ReturnType<
  typeof vi.fn
>;
const mockCacheGet = budgetApiMock.cacheGet as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveCash — budget API active path (lines 30-52)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveCash — active budget API", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  beforeEach(() => {
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockCacheGet.mockResolvedValue(null);
  });

  it("returns cash from YNAB cache when budget API is active", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [
        { onBudget: true, closed: false, type: "checking", balance: 5000 },
        { onBudget: true, closed: false, type: "savings", balance: 10000 },
        { onBudget: true, closed: false, type: "cash", balance: 200 },
        // Non-cash types should be excluded
        { onBudget: true, closed: false, type: "creditCard", balance: -1500 },
        // Closed accounts should be excluded
        { onBudget: true, closed: true, type: "checking", balance: 3000 },
        // Off-budget should be excluded
        { onBudget: false, closed: false, type: "checking", balance: 8000 },
      ],
      fetchedAt: new Date(),
    });

    const settings: { key: string; value: unknown }[] = [];
    const result = await getEffectiveCash(ctx.rawDb, settings);

    expect(result.source).toBe("ynab");
    expect(result.cash).toBe(5000 + 10000 + 200);
    expect(result.cacheAgeDays).toBe(0);
  });

  it("returns cash from Actual cache", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockResolvedValue({
      data: [
        { onBudget: true, closed: false, type: "checking", balance: 3000 },
      ],
      fetchedAt: new Date(Date.now() - 2 * 86_400_000), // 2 days old
    });

    const settings: { key: string; value: unknown }[] = [];
    const result = await getEffectiveCash(ctx.rawDb, settings);

    expect(result.source).toBe("actual");
    expect(result.cash).toBe(3000);
    expect(result.cacheAgeDays).toBe(2);
  });

  it("falls back to manual cash when budget API returns no cache", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue(null);

    // Seed manual cash setting
    ctx.db
      .insert(ctx.schema.appSettings)
      .values({ key: "current_cash", value: 7500 })
      .onConflictDoUpdate({
        target: ctx.schema.appSettings.key,
        set: { value: 7500 },
      })
      .run();

    const settings = ctx.db.select().from(ctx.schema.appSettings).all();
    const result = await getEffectiveCash(
      ctx.rawDb,
      settings as { key: string; value: unknown }[],
    );

    expect(result.source).toBe("manual");
    expect(result.cash).toBe(7500);
    expect(result.cacheAgeDays).toBeNull();
  });

  it("falls back to manual cash when no budget API is active", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("none");

    ctx.db
      .insert(ctx.schema.appSettings)
      .values({ key: "current_cash", value: 5000 })
      .onConflictDoUpdate({
        target: ctx.schema.appSettings.key,
        set: { value: 5000 },
      })
      .run();

    const settings = ctx.db.select().from(ctx.schema.appSettings).all();
    const result = await getEffectiveCash(
      ctx.rawDb,
      settings as { key: string; value: unknown }[],
    );

    expect(result.source).toBe("manual");
    expect(result.cash).toBe(5000);
    expect(result.cacheAgeDays).toBeNull();
  });

  it("returns 0 cash when no API and no manual setting", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("none");
    const result = await getEffectiveCash(ctx.rawDb, []);

    expect(result.source).toBe("manual");
    expect(result.cash).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveCash / getEffectiveCreditCardDebt — manual "cash"/"creditCard"
// account mappings (found live, 2026-08-31: Actual's API has no account
// "type" field at all, so the type-based auto-detection above never matches
// anything for an Actual household — a household maps specific accounts to
// these two fixed pseudo-buckets instead).
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveCash / getEffectiveCreditCardDebt — manual account mappings", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  beforeEach(() => {
    mockGetActiveBudgetApi.mockResolvedValue("none");
    mockCacheGet.mockResolvedValue(null);
  });

  function seedActualConnection(
    accountMappings: {
      localId: string;
      localName: string;
      remoteAccountId: string;
      syncDirection: "pull" | "push" | "both";
    }[],
  ) {
    ctx.db
      .insert(ctx.schema.apiConnections)
      .values({
        service: "actual",
        config: { serverUrl: "http://actual.local" },
        accountMappings,
      })
      .onConflictDoUpdate({
        target: ctx.schema.apiConnections.service,
        set: { accountMappings },
      })
      .run();
  }

  it("sums cash across multiple accounts mapped to the fixed 'cash' bucket, ignoring type", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockResolvedValue({
      data: [
        // No `type`/`onBudget` fields at all — matches Actual's real cache
        // shape (getCategories()/getAccounts() have nothing to fill them
        // with), which is exactly why the auto-detection path can't work.
        { id: "acct-checking", balance: 3000 },
        { id: "acct-savings", balance: 15000 },
        { id: "acct-other", balance: 999999 }, // unmapped — must be excluded
      ],
      fetchedAt: new Date(),
    });
    seedActualConnection([
      {
        localId: "cash",
        localName: "Cash",
        remoteAccountId: "acct-checking",
        syncDirection: "pull",
      },
      {
        localId: "cash",
        localName: "Cash",
        remoteAccountId: "acct-savings",
        syncDirection: "pull",
      },
    ]);

    const result = await getEffectiveCash(ctx.rawDb, []);
    expect(result.source).toBe("actual");
    expect(result.cash).toBe(3000 + 15000);
  });

  it("falls back to type-based auto-detection when no 'cash' mapping exists", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("ynab");
    mockCacheGet.mockResolvedValue({
      data: [{ onBudget: true, closed: false, type: "checking", balance: 500 }],
      fetchedAt: new Date(),
    });
    seedActualConnection([]); // no mappings at all

    const result = await getEffectiveCash(ctx.rawDb, []);
    expect(result.cash).toBe(500);
  });

  it("sums credit card debt as positive magnitude from mapped accounts", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockResolvedValue({
      data: [
        { id: "acct-visa", balance: -1200 },
        { id: "acct-amex", balance: -350 },
      ],
      fetchedAt: new Date(),
    });
    seedActualConnection([
      {
        localId: "creditCard",
        localName: "Credit Card",
        remoteAccountId: "acct-visa",
        syncDirection: "pull",
      },
      {
        localId: "creditCard",
        localName: "Credit Card",
        remoteAccountId: "acct-amex",
        syncDirection: "pull",
      },
    ]);

    const debt = await getEffectiveCreditCardDebt(ctx.rawDb);
    expect(debt).toBe(1200 + 350);
  });

  it("returns 0 credit card debt when nothing is mapped (no auto-detection fallback)", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    seedActualConnection([]);
    const debt = await getEffectiveCreditCardDebt(ctx.rawDb);
    expect(debt).toBe(0);
  });

  it("ignores a 'both'-direction credit card mapping's push side but still sums it (pull applies)", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockResolvedValue({
      data: [{ id: "acct-visa", balance: -800 }],
      fetchedAt: new Date(),
    });
    seedActualConnection([
      {
        localId: "creditCard",
        localName: "Credit Card",
        remoteAccountId: "acct-visa",
        syncDirection: "both",
      },
    ]);
    const debt = await getEffectiveCreditCardDebt(ctx.rawDb);
    expect(debt).toBe(800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveOtherAssetsDetailed — carry-forward logic (lines 96-125)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveOtherAssetsDetailed — carry-forward", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("carries forward latest entry for each asset name", async () => {
    const currentYear = new Date().getFullYear();

    // Insert asset items for multiple years
    ctx.db
      .insert(ctx.schema.otherAssetItems)
      .values([
        { name: "Car", year: currentYear - 2, value: "20000" },
        { name: "Car", year: currentYear - 1, value: "18000" },
        { name: "Car", year: currentYear, value: "16000" },
        { name: "Boat", year: currentYear - 1, value: "30000" },
        // Boat has no current year entry — should carry forward from last year
      ])
      .run();

    const settings: { key: string; value: unknown }[] = [];
    const result = await getEffectiveOtherAssetsDetailed(ctx.rawDb, settings);

    expect(result.items.length).toBe(2);

    const car = result.items.find((i) => i.name === "Car");
    expect(car).toBeDefined();
    expect(car!.value).toBe(16000);
    expect(car!.sourceYear).toBe(currentYear);

    const boat = result.items.find((i) => i.name === "Boat");
    expect(boat).toBeDefined();
    expect(boat!.value).toBe(30000);
    expect(boat!.sourceYear).toBe(currentYear - 1);

    expect(result.total).toBe(16000 + 30000);
  });

  it("excludes assets with zero value", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([
          { name: "Sold Car", year: currentYear, value: "0" },
          { name: "Valuable Art", year: currentYear, value: "5000" },
        ])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Valuable Art");
      expect(result.total).toBe(5000);
    } finally {
      ctx2.cleanup();
    }
  });

  it("excludes future-year entries", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([
          { name: "Future Asset", year: currentYear + 5, value: "99999" },
          { name: "Current Asset", year: currentYear, value: "10000" },
        ])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
      );

      // Future asset should be excluded
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Current Asset");
      expect(result.total).toBe(10000);
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns items with id from DB rows", async () => {
    const ctx2 = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();

      ctx2.db
        .insert(ctx2.schema.otherAssetItems)
        .values([{ name: "House Equity", year: currentYear, value: "50000" }])
        .run();

      const settings: { key: string; value: unknown }[] = [];
      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings,
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0]!.id).not.toBeNull();
      expect(typeof result.items[0]!.id).toBe("number");
    } finally {
      ctx2.cleanup();
    }
  });

  it("falls back to manual scalar when no items exist", async () => {
    const ctx2 = await createTestDb();
    try {
      ctx2.db
        .insert(ctx2.schema.appSettings)
        .values({ key: "current_other_assets", value: 25000 })
        .run();

      const settings = ctx2.db.select().from(ctx2.schema.appSettings).all();

      const result = await getEffectiveOtherAssetsDetailed(
        ctx2.rawDb,
        settings as { key: string; value: unknown }[],
      );

      expect(result.total).toBe(25000);
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.name).toBe("Other Assets");
      expect(result.items[0]!.id).toBeNull();
    } finally {
      ctx2.cleanup();
    }
  });

  it("returns empty items and zero total when no items and no manual setting", async () => {
    const ctx2 = await createTestDb();
    try {
      const result = await getEffectiveOtherAssetsDetailed(ctx2.rawDb, []);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    } finally {
      ctx2.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEffectiveOtherAssets — delegates to detailed version (line 76)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveOtherAssets — returns total only", () => {
  it("returns numeric total from items", async () => {
    const ctx = await createTestDb();
    try {
      const currentYear = new Date().getFullYear();
      ctx.db
        .insert(ctx.schema.otherAssetItems)
        .values([
          { name: "Asset A", year: currentYear, value: "10000" },
          { name: "Asset B", year: currentYear, value: "5000" },
        ])
        .run();

      const result = await getEffectiveOtherAssets(ctx.rawDb, []);
      expect(result).toBe(15000);
    } finally {
      ctx.cleanup();
    }
  });
});
