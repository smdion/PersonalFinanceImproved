import "../../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  buildYearEndHistory,
  invalidateYearEndCache,
} from "@/server/services/net-worth/year-end-history";
import { createTestDb, type TestDbContext } from "../../../helpers/db-harness";

// ---------------------------------------------------------------------------
// buildYearEndHistory (DB-dependent)
// ---------------------------------------------------------------------------

/** The day the history is built on (the router tests' TEST_NOW): the
 *  same rows on every day the suite runs. */
const AS_OF = new Date("2026-03-07T18:00:00.000Z");
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
    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    expect(Array.isArray(rows)).toBe(true);
    // Should have at least a current-year YTD row
    const currentYear = AS_OF.getFullYear();
    const currentRow = rows.find((r) => r.year === currentYear);
    expect(currentRow).toBeDefined();
    expect(currentRow!.isCurrent).toBe(true);
  });

  it("caches the history until invalidateYearEndCache is called", async () => {
    const before = await buildYearEndHistory(ctx.rawDb, AS_OF);
    expect(before.some((r) => r.year === 2019)).toBe(false);

    ctx.db
      .insert(ctx.schema.netWorthAnnual)
      .values({
        yearEndDate: "2019-12-31",
        portfolioTotal: "1000",
        cash: "0",
        houseValue: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    // Still the cached result...
    const cached = await buildYearEndHistory(ctx.rawDb, AS_OF);
    expect(cached.some((r) => r.year === 2019)).toBe(false);

    // ...until invalidated.
    invalidateYearEndCache();
    const fresh = await buildYearEndHistory(ctx.rawDb, AS_OF);
    expect(fresh.some((r) => r.year === 2019)).toBe(true);

    ctx.db.delete(ctx.schema.netWorthAnnual).run();
  });

  it("never shares an entry between database handles (demo vs real)", async () => {
    const other = await createTestDb();
    try {
      other.db
        .insert(other.schema.netWorthAnnual)
        .values({
          yearEndDate: "2019-12-31",
          portfolioTotal: "1000",
          cash: "0",
          houseValue: "0",
          otherAssets: "0",
          mortgageBalance: "0",
          otherLiabilities: "0",
          portfolioByTaxLocation: { retirement: {}, portfolio: {} },
        })
        .run();
      const fromOther = await buildYearEndHistory(other.rawDb, AS_OF);
      expect(fromOther.some((r) => r.year === 2019)).toBe(true);
      // Same arguments on a different handle → its own build, not the other's.
      const fromCtx = await buildYearEndHistory(ctx.rawDb, AS_OF);
      expect(fromCtx.some((r) => r.year === 2019)).toBe(false);
    } finally {
      other.cleanup();
    }
  });

  it("caches targeted calls per targeting, never across different targeting", async () => {
    const profileA = { budgetProfileId: 1, budgetColumn: 0 };
    const before = await buildYearEndHistory(ctx.rawDb, AS_OF, profileA);
    expect(before.some((r) => r.year === 2019)).toBe(false);

    ctx.db
      .insert(ctx.schema.netWorthAnnual)
      .values({
        yearEndDate: "2019-12-31",
        portfolioTotal: "1000",
        cash: "0",
        houseValue: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    // Same targeting → the cached build (a page's second caller).
    const again = await buildYearEndHistory(ctx.rawDb, AS_OF, {
      ...profileA,
    });
    expect(again.some((r) => r.year === 2019)).toBe(false);
    // Different targeting → its own fresh build.
    const other = await buildYearEndHistory(ctx.rawDb, AS_OF, {
      ...profileA,
      budgetColumn: 1,
    });
    expect(other.some((r) => r.year === 2019)).toBe(true);

    ctx.db.delete(ctx.schema.netWorthAnnual).run();
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
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
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

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
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
    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
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

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // With performance data, portfolioTotal should come from account_performance
    expect(row2023.portfolioTotal).toBe(380000);
    expect(row2023.portfolioByType).toHaveProperty("401k");
  });

  it("includes per-account performance breakdown", async () => {
    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
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
    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // Should have computed performance summary from account_performance
    expect(row2023.perfBeginningBalance).toBe(300000);
    expect(row2023.perfContributions).toBe(20000);
    expect(row2023.perfEmployerMatch).toBe(10000);
    expect(row2023.perfGainLoss).toBe(50000);
    expect(row2023.perfReturnPct).not.toBeNull();
  });

  it("includes rollovers in the Modified-Dietz return% denominator", async () => {
    // Regression test: year-end-history.ts previously hand-rolled the denominator
    // without `rollovers`, diverging from computeReturn() in
    // src/lib/pure/investments/returns.ts. Uses a fresh year (2021) to avoid
    // interfering with the 2023 fixtures shared across this describe block.
    // A net_worth_annual row is required for the year to appear in
    // buildYearEndHistory's output at all — historical rows are built from
    // net_worth_annual, then enriched with perf* fields from account_performance.
    ctx.db
      .insert(ctx.schema.netWorthAnnual)
      .values({
        yearEndDate: "2021-12-31",
        portfolioTotal: "5000",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "5000",
        rBrokerage: "0",
        cash: "0",
        houseValue: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        grossIncome: "0",
        combinedAgi: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    const perfAcct = ctx.db
      .insert(ctx.schema.performanceAccounts)
      .values({
        institution: "UBS",
        accountType: "brokerage",
        accountLabel: "ESPP",
        ownershipType: "individual",
        parentCategory: "Portfolio",
      })
      .returning()
      .get();

    ctx.db
      .insert(ctx.schema.accountPerformance)
      .values({
        year: 2021,
        performanceAccountId: perfAcct.id,
        institution: "UBS",
        accountLabel: "ESPP",
        parentCategory: "Portfolio",
        beginningBalance: "10000",
        endingBalance: "5000",
        totalContributions: "3000",
        employerContributions: "500",
        yearlyGainLoss: "-2000",
        distributions: "0",
        fees: "0",
        rollovers: "-4000",
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    const row2021 = rows.find((r) => r.year === 2021)!;
    // Modified Dietz: denom = beginBal + (contribs + rollovers - distributions - fees) / 2
    //                       = 10000 + (3000 + (-4000) - 0 - 0) / 2 = 9500
    // returnPct = gainLoss / denom = -2000 / 9500
    expect(row2021.perfReturnPct).toBeCloseTo(-2000 / 9500, 4);
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

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    const row2023 = rows.find((r) => r.year === 2023)!;
    // Should use finalized data
    expect(row2023.perfBeginningBalance).toBe(310000);
    expect(row2023.perfContributions).toBe(22000);
    expect(row2023.perfReturnPct).toBeCloseTo(0.145, 3);
  });

  it("caching returns same data within TTL", async () => {
    const first = await buildYearEndHistory(ctx.rawDb, AS_OF);
    const second = await buildYearEndHistory(ctx.rawDb, AS_OF);
    // Should be the exact same array reference (cached)
    expect(first).toBe(second);
  });

  it("invalidating cache causes fresh fetch", async () => {
    const first = await buildYearEndHistory(ctx.rawDb, AS_OF);
    invalidateYearEndCache();
    const second = await buildYearEndHistory(ctx.rawDb, AS_OF);
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

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
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

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
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
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    const rows = await buildYearEndHistory(ctx.rawDb, AS_OF);
    // Check ordering of historical rows
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.year).toBeGreaterThanOrEqual(rows[i - 1]!.year);
    }
  });
});
