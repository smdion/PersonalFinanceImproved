/**
 * Snapshot helper tests.
 *
 * Tests groupSnapshotAccounts (pure), getLatestSnapshot (DB-dependent),
 * buildYearEndHistory (DB-dependent), and invalidateYearEndCache.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  groupSnapshotAccounts,
  getLatestSnapshot,
  buildYearEndHistory,
  invalidateYearEndCache,
} from "@/server/helpers/snapshot";
import { createTestDb, type TestDbContext } from "./db-harness";

// ---------------------------------------------------------------------------
// groupSnapshotAccounts (pure)
// ---------------------------------------------------------------------------

describe("groupSnapshotAccounts", () => {
  it("returns empty map for empty array", () => {
    const result = groupSnapshotAccounts([]);
    expect(result.size).toBe(0);
  });

  it("groups accounts by snapshotId", () => {
    const accounts = [
      { snapshotId: 1, name: "A" },
      { snapshotId: 1, name: "B" },
      { snapshotId: 2, name: "C" },
      { snapshotId: 3, name: "D" },
      { snapshotId: 2, name: "E" },
    ];
    const result = groupSnapshotAccounts(accounts);
    expect(result.size).toBe(3);
    expect(result.get(1)).toHaveLength(2);
    expect(result.get(2)).toHaveLength(2);
    expect(result.get(3)).toHaveLength(1);
  });

  it("preserves account objects by reference", () => {
    const a = { snapshotId: 1, extra: "data" };
    const result = groupSnapshotAccounts([a]);
    expect(result.get(1)![0]).toBe(a);
  });

  it("handles single snapshot ID", () => {
    const accounts = [{ snapshotId: 5 }, { snapshotId: 5 }, { snapshotId: 5 }];
    const result = groupSnapshotAccounts(accounts);
    expect(result.size).toBe(1);
    expect(result.get(5)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getLatestSnapshot (DB-dependent)
// ---------------------------------------------------------------------------

describe("getLatestSnapshot", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("returns null when no snapshots exist", async () => {
    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).toBeNull();
  });

  it("returns null for non-existent snapshot ID", async () => {
    const result = await getLatestSnapshot(ctx.rawDb, 99999);
    expect(result).toBeNull();
  });

  it("returns snapshot after seeding one", async () => {
    // Seed a snapshot
    ctx.db
      .insert(ctx.schema.portfolioSnapshots)
      .values({
        snapshotDate: "2025-12-31",
        totalBalance: "100000",
      })
      .run();

    const snap = ctx.db.select().from(ctx.schema.portfolioSnapshots).all()[0]!;

    // Seed an account
    ctx.db
      .insert(ctx.schema.portfolioAccounts)
      .values({
        snapshotId: snap.id,
        institution: "Vanguard",
        taxType: "roth",
        accountType: "ira",
        amount: "25000",
      })
      .run();

    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).not.toBeNull();
    expect(result!.snapshot.id).toBe(snap.id);
    expect(result!.accounts).toHaveLength(1);
    expect(result!.accounts[0].institution).toBe("Vanguard");
    expect(result!.accounts[0].amount).toBe(25000);
    expect(result!.total).toBe(25000);
  });

  it("returns latest snapshot by date when no ID specified", async () => {
    // Seed a newer snapshot
    ctx.db
      .insert(ctx.schema.portfolioSnapshots)
      .values({
        snapshotDate: "2026-03-15",
        totalBalance: "120000",
      })
      .run();

    const result = await getLatestSnapshot(ctx.rawDb);
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2026-03-15");
  });

  it("returns specific snapshot by ID", async () => {
    const snaps = ctx.db.select().from(ctx.schema.portfolioSnapshots).all();
    const oldest = snaps.find((s) => s.snapshotDate === "2025-12-31")!;

    const result = await getLatestSnapshot(ctx.rawDb, oldest.id);
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-12-31");
  });

  it("computes total from multiple accounts", async () => {
    const snap = ctx.db
      .select()
      .from(ctx.schema.portfolioSnapshots)
      .all()
      .find((s) => s.snapshotDate === "2026-03-15")!;

    ctx.db
      .insert(ctx.schema.portfolioAccounts)
      .values([
        {
          snapshotId: snap.id,
          institution: "Fidelity",
          taxType: "traditional",
          accountType: "401k",
          amount: "50000",
        },
        {
          snapshotId: snap.id,
          institution: "Schwab",
          taxType: "taxable",
          accountType: "brokerage",
          amount: "30000",
        },
      ])
      .run();

    const result = await getLatestSnapshot(ctx.rawDb, snap.id);
    expect(result!.accounts).toHaveLength(2);
    expect(result!.total).toBe(80000);
  });
});

// ---------------------------------------------------------------------------
// invalidateYearEndCache
// ---------------------------------------------------------------------------

describe("invalidateYearEndCache", () => {
  it("does not throw", () => {
    expect(() => invalidateYearEndCache()).not.toThrow();
  });

  it("can be called multiple times", () => {
    invalidateYearEndCache();
    invalidateYearEndCache();
  });
});

// ---------------------------------------------------------------------------
// buildYearEndHistory (DB-dependent)
// ---------------------------------------------------------------------------

describe("buildYearEndHistory", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  // Always invalidate cache before each test so prior test results don't leak
  beforeEach(() => {
    invalidateYearEndCache();
  });

  it("returns an array with at least a current-year row when DB is empty", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb);
    expect(Array.isArray(rows)).toBe(true);
    // Should have at least a current-year YTD row
    const currentYear = new Date().getFullYear();
    const currentRow = rows.find((r) => r.year === currentYear);
    expect(currentRow).toBeDefined();
    expect(currentRow!.isCurrent).toBe(true);
  });

  it("current-year row has expected fields", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb);
    const currentYear = new Date().getFullYear();
    const current = rows.find((r) => r.year === currentYear)!;

    // Check all expected fields exist
    expect(current).toHaveProperty("netWorth");
    expect(current).toHaveProperty("portfolioTotal");
    expect(current).toHaveProperty("portfolioByType");
    expect(current).toHaveProperty("cash");
    expect(current).toHaveProperty("houseValue");
    expect(current).toHaveProperty("otherAssets");
    expect(current).toHaveProperty("mortgageBalance");
    expect(current).toHaveProperty("otherLiabilities");
    expect(current).toHaveProperty("grossIncome");
    expect(current).toHaveProperty("perfByAccount");
    expect(typeof current.netWorth).toBe("number");
  });

  it("returns historical rows from net_worth_annual", async () => {
    // Seed a historical year
    ctx.db
      .insert(ctx.schema.netWorthAnnual)
      .values({
        yearEndDate: "2023-12-31",
        portfolioTotal: "500000",
        retirementTotal: "400000",
        hsa: "10000",
        ltBrokerage: "50000",
        espp: "30000",
        rBrokerage: "10000",
        cash: "20000",
        houseValue: "350000",
        otherAssets: "5000",
        mortgageBalance: "250000",
        otherLiabilities: "0",
        grossIncome: "180000",
        combinedAgi: "160000",
        homeImprovementsCumulative: "15000",
      })
      .run();

    // Home improvement items — source of truth for cumulative improvements
    ctx.db
      .insert(ctx.schema.homeImprovementItems)
      .values({
        year: 2023,
        description: "Kitchen remodel",
        cost: "15000",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023);
    expect(row2023).toBeDefined();
    expect(row2023!.isCurrent).toBe(false);
    expect(row2023!.portfolioTotal).toBe(500000);
    expect(row2023!.cash).toBe(20000);
    expect(row2023!.houseValue).toBe(350000);
    expect(row2023!.grossIncome).toBe(180000);
    expect(row2023!.homeImprovements).toBe(15000);
  });

  it("computes net worth from components", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // netWorth = portfolio + cash + house + other - mortgage - otherLiabilities
    const expected =
      row2023.portfolioTotal +
      row2023.cash +
      row2023.houseValue +
      row2023.otherAssets -
      row2023.mortgageBalance -
      row2023.otherLiabilities;
    expect(row2023.netWorth).toBeCloseTo(expected, 2);
  });

  it("uses performance data when available", async () => {
    // Seed performance account + account_performance
    const perfAcct = ctx.db
      .insert(ctx.schema.performanceAccounts)
      .values({
        institution: "Fidelity",
        accountType: "401k",
        accountLabel: "Fidelity 401k",
        ownershipType: "individual",
        parentCategory: "Retirement",
      })
      .returning()
      .get();

    ctx.db
      .insert(ctx.schema.accountPerformance)
      .values({
        year: 2023,
        performanceAccountId: perfAcct.id,
        institution: "Fidelity",
        accountLabel: "Fidelity 401k",
        parentCategory: "Retirement",
        beginningBalance: "300000",
        endingBalance: "380000",
        totalContributions: "20000",
        employerContributions: "10000",
        yearlyGainLoss: "50000",
        distributions: "0",
        fees: "0",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // With performance data, portfolioTotal should come from account_performance
    expect(row2023.portfolioTotal).toBe(380000);
    expect(row2023.portfolioByType).toHaveProperty("401k");
  });

  it("includes per-account performance breakdown", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    expect(row2023.perfByAccount.length).toBeGreaterThan(0);
    const acct = row2023.perfByAccount[0]!;
    expect(acct).toHaveProperty("label");
    expect(acct).toHaveProperty("beginningBalance");
    expect(acct).toHaveProperty("contributions");
    expect(acct).toHaveProperty("gainLoss");
    expect(acct).toHaveProperty("endingBalance");
  });

  it("includes performance summary from account data", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // Should have computed performance summary from account_performance
    expect(row2023.perfBeginningBalance).toBe(300000);
    expect(row2023.perfContributions).toBe(20000);
    expect(row2023.perfEmployerMatch).toBe(10000);
    expect(row2023.perfGainLoss).toBe(50000);
    expect(row2023.perfReturnPct).not.toBeNull();
  });

  it("prefers finalized annual_performance over computed", async () => {
    // Seed a finalized annual_performance row for 2023
    ctx.db
      .insert(ctx.schema.annualPerformance)
      .values({
        year: 2023,
        category: "Portfolio",
        beginningBalance: "310000",
        endingBalance: "390000",
        totalContributions: "22000",
        employerContributions: "11000",
        yearlyGainLoss: "47000",
        annualReturnPct: "0.145",
        lifetimeGains: "100000",
        lifetimeContributions: "80000",
        lifetimeMatch: "40000",
        isFinalized: true,
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // Should use finalized data
    expect(row2023.perfBeginningBalance).toBe(310000);
    expect(row2023.perfContributions).toBe(22000);
    expect(row2023.perfReturnPct).toBeCloseTo(0.145, 3);
  });

  it("caching returns same data within TTL", async () => {
    const first = await buildYearEndHistory(ctx.rawDb);
    const second = await buildYearEndHistory(ctx.rawDb);
    // Should be the exact same array reference (cached)
    expect(first).toBe(second);
  });

  it("invalidating cache causes fresh fetch", async () => {
    const first = await buildYearEndHistory(ctx.rawDb);
    invalidateYearEndCache();
    const second = await buildYearEndHistory(ctx.rawDb);
    // New array (not same reference), but same data
    expect(first).not.toBe(second);
    expect(first.length).toBe(second.length);
  });

  it("includes mortgage balance from loan amortization", async () => {
    // Seed a mortgage loan
    ctx.db
      .insert(ctx.schema.mortgageLoans)
      .values({
        name: "Test Mortgage",
        isActive: true,
        principalAndInterest: "1770",
        interestRate: "0.065",
        termYears: 30,
        originalLoanAmount: "280000",
        firstPaymentDate: "2022-09-01",
        propertyValuePurchase: "350000",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // Should have a mortgage balance computed from amortization
    expect(row2023.mortgageBalance).toBeGreaterThan(0);
    // Should be less than original balance after ~1 year of payments
    expect(row2023.mortgageBalance).toBeLessThan(280000);
  });

  it("includes property taxes when available", async () => {
    const loans = ctx.db.select().from(ctx.schema.mortgageLoans).all();
    const loanId = loans[0]!.id;

    ctx.db
      .insert(ctx.schema.propertyTaxes)
      .values({
        loanId,
        year: 2023,
        taxAmount: "4500",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    const row2023 = rows.find((r) => r.year === 2023)!;
    expect(row2023.propertyTaxes).toBe(4500);
  });

  it("rows are ordered chronologically", async () => {
    // Seed another historical year
    ctx.db
      .insert(ctx.schema.netWorthAnnual)
      .values({
        yearEndDate: "2022-12-31",
        portfolioTotal: "400000",
        retirementTotal: "300000",
        hsa: "8000",
        ltBrokerage: "40000",
        espp: "25000",
        rBrokerage: "5000",
        cash: "15000",
        houseValue: "330000",
        otherAssets: "3000",
        mortgageBalance: "270000",
        otherLiabilities: "0",
        grossIncome: "170000",
        combinedAgi: "150000",
        homeImprovementsCumulative: "10000",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb);
    // Check ordering of historical rows
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.year).toBeGreaterThanOrEqual(rows[i - 1]!.year);
    }
  });
});
