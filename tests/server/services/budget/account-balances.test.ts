/**
 * getEffectiveCash and getEffectiveCreditCardDebt: the active budget API's
 * cached balances, and the manual cash/credit-card account mappings.
 */
import "../../../helpers/setup-mocks";
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
} from "@/server/services/budget/account-balances";
import { createTestDb, type TestDbContext } from "../../../helpers/db-harness";

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

  it("nothing detected as cash: the manual figure, not $0 from the API", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    mockCacheGet.mockResolvedValue({
      data: [{ onBudget: true, closed: false, type: "other", balance: 3000 }],
      fetchedAt: new Date(),
    });
    ctx.db
      .insert(ctx.schema.appSettings)
      .values({ key: "current_cash", value: 6200 })
      .onConflictDoUpdate({
        target: ctx.schema.appSettings.key,
        set: { value: 6200 },
      })
      .run();
    const settings = ctx.db.select().from(ctx.schema.appSettings).all();
    const result = await getEffectiveCash(
      ctx.rawDb,
      settings as { key: string; value: unknown }[],
    );
    expect(result).toEqual({
      cash: 6200,
      source: "manual",
      cacheAgeDays: null,
      missingAccounts: 0,
    });
  });

  it("mapped cash keeps each balance's sign and reports the cache's real age", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    ctx.db
      .insert(ctx.schema.apiConnections)
      .values({
        service: "actual",
        config: {},
        accountMappings: [
          {
            localId: "cash",
            localName: "Cash",
            remoteAccountId: "chk",
            syncDirection: "pull",
          },
          {
            localId: "cash",
            localName: "Cash",
            remoteAccountId: "sav",
            syncDirection: "pull",
          },
        ],
      })
      .run();
    mockCacheGet.mockResolvedValue({
      data: [
        { id: "chk", balance: -500 }, // overdrawn checking
        { id: "sav", balance: 4000 },
      ],
      fetchedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    try {
      const result = await getEffectiveCash(ctx.rawDb, []);
      expect(result).toEqual({
        cash: 3500,
        source: "actual",
        cacheAgeDays: 3,
        missingAccounts: 0,
      });
    } finally {
      ctx.db.delete(ctx.schema.apiConnections).run();
    }
  });

  it("a mapped account the budget app no longer lists is counted and flagged and reports the cache's real age", async () => {
    mockGetActiveBudgetApi.mockResolvedValue("actual");
    ctx.db
      .insert(ctx.schema.apiConnections)
      .values({
        service: "actual",
        config: {},
        accountMappings: [
          {
            localId: "cash",
            localName: "Cash",
            remoteAccountId: "chk",
            syncDirection: "pull",
          },
          {
            localId: "cash",
            localName: "Cash",
            remoteAccountId: "sav",
            syncDirection: "pull",
          },
        ],
      })
      .run();
    mockCacheGet.mockResolvedValue({
      data: [
        { id: "sav", balance: 4000 }, // "chk" was closed in the budget app
      ],
      fetchedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    try {
      const result = await getEffectiveCash(ctx.rawDb, []);
      expect(result).toMatchObject({ cash: 4000, missingAccounts: 1 });
    } finally {
      ctx.db.delete(ctx.schema.apiConnections).run();
    }
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
