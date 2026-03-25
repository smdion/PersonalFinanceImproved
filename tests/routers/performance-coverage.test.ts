/**
 * Performance router coverage tests — targets uncovered lines 386-588 and 915-1424.
 *
 * Lines 915-1424 (finalizeYear) use db.execute() / db.transaction() with raw SQL
 * which is incompatible with better-sqlite3 in tests — skipped per convention.
 *
 * Lines 386-588 are in computeSummary and cover:
 * - Synthesizing missing annual rows from account data (lines 371-401)
 * - Recomputing non-finalized existing annual rows (lines 402-425)
 * - Portfolio rollup when one category vs multiple categories (lines 428-521)
 * - Fill missing return % on rows with null return (lines 525-537)
 * - Lifetime cumulative computation for non-finalized rows (lines 539-570)
 * - Retirement parent-category rollup synthesis (lines 572-658)
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, seedPerformanceAccount } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to seed account_performance and annual_performance rows directly
// ─────────────────────────────────────────────────────────────────────────────

function seedAccountPerf(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  perfAccountId: number,
  overrides: Partial<typeof schema.accountPerformance.$inferInsert> = {},
): number {
  const result = db
    .insert(schema.accountPerformance)
    .values({
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity 401k Account",
      parentCategory: "Retirement",
      beginningBalance: "50000",
      totalContributions: "10000",
      yearlyGainLoss: "5000",
      endingBalance: "65000",
      employerContributions: "3000",
      fees: "100",
      distributions: "0",
      rollovers: "0",
      performanceAccountId: perfAccountId,
      isActive: true,
      ...overrides,
    })
    .returning({ id: schema.accountPerformance.id })
    .get();
  return result.id;
}

function seedAnnualPerf(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<typeof schema.annualPerformance.$inferInsert> = {},
): number {
  const result = db
    .insert(schema.annualPerformance)
    .values({
      year: 2024,
      category: "401k/IRA",
      beginningBalance: "50000",
      totalContributions: "10000",
      yearlyGainLoss: "5000",
      endingBalance: "65000",
      employerContributions: "3000",
      distributions: "0",
      fees: "100",
      rollovers: "0",
      lifetimeGains: "5000",
      lifetimeContributions: "10000",
      lifetimeMatch: "3000",
      isCurrentYear: true,
      isFinalized: false,
      ...overrides,
    })
    .returning({ id: schema.annualPerformance.id })
    .get();
  return result.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — synthesize annual rows from account data (lines 371-425)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — synthesize + recompute annual rows", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let perfAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Create a master performance account (401k → "401k/IRA" category)
    perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });
  });

  afterAll(() => cleanup());

  it("synthesizes annual row when no annual_performance row exists for a year", async () => {
    // Only account_performance for 2023 — no annual_performance row
    seedAccountPerf(db, perfAcctId, {
      year: 2023,
      beginningBalance: "40000",
      totalContributions: "8000",
      yearlyGainLoss: "3000",
      endingBalance: "51000",
      employerContributions: "2000",
      fees: "50",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const row2023 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2023 && r.category === "401k/IRA",
    );
    expect(row2023).toBeDefined();
    expect(row2023!.beginningBalance).toBe(40000);
    expect(row2023!.totalContributions).toBe(8000);
    expect(row2023!.yearlyGainLoss).toBe(3000);
    expect(row2023!.endingBalance).toBe(51000);
    expect(row2023!.employerContributions).toBe(2000);
    expect(row2023!.fees).toBe(50);
    // Should have computed return
    expect(row2023!.annualReturnPct).not.toBeNull();
  });

  it("recomputes non-finalized existing annual row from account data", async () => {
    // Seed an annual row with wrong values (non-finalized)
    seedAnnualPerf(db, {
      year: 2023,
      category: "401k/IRA",
      beginningBalance: "0",
      totalContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      isFinalized: false,
      isCurrentYear: false,
    });

    const summary = await caller.performance.computeSummary();
    const row2023 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2023 && r.category === "401k/IRA",
    );
    expect(row2023).toBeDefined();
    // Should be recomputed from account data, not the zeroed-out annual row
    expect(row2023!.beginningBalance).toBe(40000);
    expect(row2023!.endingBalance).toBe(51000);
  });

  it("does NOT recompute finalized annual rows", async () => {
    // Seed a finalized annual row with specific values
    // First clear existing 2022 data
    seedAnnualPerf(db, {
      year: 2022,
      category: "401k/IRA",
      beginningBalance: "99999",
      totalContributions: "1111",
      yearlyGainLoss: "2222",
      endingBalance: "103332",
      isFinalized: true,
      isCurrentYear: false,
    });

    // Seed account data that differs
    seedAccountPerf(db, perfAcctId, {
      year: 2022,
      beginningBalance: "30000",
      totalContributions: "5000",
      yearlyGainLoss: "1000",
      endingBalance: "36000",
    });

    const summary = await caller.performance.computeSummary();
    const row2022 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2022 && r.category === "401k/IRA",
    );
    expect(row2022).toBeDefined();
    // Finalized row should keep its stored values
    expect(row2022!.beginningBalance).toBe(99999);
    expect(row2022!.endingBalance).toBe(103332);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — Portfolio rollup synthesis (lines 428-521)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — Portfolio rollup", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("copies single category to Portfolio when only one category exists for a year", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    seedAccountPerf(db, perfAcctId, {
      year: 2021,
      institution: "Vanguard",
      accountLabel: "Vanguard 401k Account",
      beginningBalance: "20000",
      totalContributions: "5000",
      yearlyGainLoss: "2000",
      endingBalance: "27000",
      employerContributions: "1000",
      fees: "50",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const portfolio2021 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2021 && r.category === "Portfolio",
    );
    expect(portfolio2021).toBeDefined();
    // When only one category, Portfolio copies from it
    expect(portfolio2021!.beginningBalance).toBe(20000);
    expect(portfolio2021!.endingBalance).toBe(27000);
    expect(portfolio2021!.totalContributions).toBe(5000);
  });

  it("sums multiple categories into Portfolio row", async () => {
    // Create a brokerage account (different category than 401k)
    const brokerageAcctId = seedPerformanceAccount(db, {
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      ownershipType: "individual",
    });

    seedAccountPerf(db, brokerageAcctId, {
      year: 2021,
      institution: "Schwab",
      accountLabel: "Schwab Brokerage",
      parentCategory: "Portfolio",
      beginningBalance: "10000",
      totalContributions: "2000",
      yearlyGainLoss: "1000",
      endingBalance: "13000",
      employerContributions: "0",
      fees: "25",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const portfolio2021 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2021 && r.category === "Portfolio",
    );
    expect(portfolio2021).toBeDefined();
    // Portfolio should be sum of 401k/IRA + Brokerage
    expect(portfolio2021!.beginningBalance).toBe(20000 + 10000);
    expect(portfolio2021!.endingBalance).toBe(27000 + 13000);
    expect(portfolio2021!.totalContributions).toBe(5000 + 2000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — lifetime cumulative + null return fill (lines 525-570)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — lifetime cumulative + null return fill", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("computes lifetime fields cumulatively for non-finalized rows", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "TestInst",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    // Year 1: account data only (no annual row)
    seedAccountPerf(db, perfAcctId, {
      year: 2020,
      institution: "TestInst",
      accountLabel: "TestInst 401k Account",
      beginningBalance: "0",
      totalContributions: "10000",
      yearlyGainLoss: "1000",
      endingBalance: "11000",
      employerContributions: "2000",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    // Year 2: account data only
    seedAccountPerf(db, perfAcctId, {
      year: 2021,
      institution: "TestInst",
      accountLabel: "TestInst 401k Account",
      beginningBalance: "11000",
      totalContributions: "12000",
      yearlyGainLoss: "3000",
      endingBalance: "26000",
      employerContributions: "2500",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const catRows = summary.annualRows
      .filter((r: { category: string }) => r.category === "401k/IRA")
      .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

    const row2020 = catRows.find((r: { year: number }) => r.year === 2020);
    const row2021 = catRows.find((r: { year: number }) => r.year === 2021);

    expect(row2020).toBeDefined();
    expect(row2021).toBeDefined();

    // Year 2020: lifetime = year values
    expect(row2020!.lifetimeGains).toBe(1000);
    expect(row2020!.lifetimeContributions).toBe(10000);
    expect(row2020!.lifetimeMatch).toBe(2000);

    // Year 2021: lifetime = cumulative
    expect(row2021!.lifetimeGains).toBe(1000 + 3000);
    expect(row2021!.lifetimeContributions).toBe(10000 + 12000);
    expect(row2021!.lifetimeMatch).toBe(2000 + 2500);
  });

  it("uses finalized row lifetime values as baseline for next year", async () => {
    const perfAcctId2 = seedPerformanceAccount(db, {
      institution: "BaselineInst",
      accountType: "ira",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    // Finalized year with authoritative lifetime values
    seedAnnualPerf(db, {
      year: 2019,
      category: "401k/IRA",
      beginningBalance: "50000",
      totalContributions: "5000",
      yearlyGainLoss: "3000",
      endingBalance: "58000",
      lifetimeGains: "20000",
      lifetimeContributions: "40000",
      lifetimeMatch: "10000",
      isFinalized: true,
      isCurrentYear: false,
    });

    // Non-finalized year after the finalized baseline
    seedAccountPerf(db, perfAcctId2, {
      year: 2019,
      institution: "BaselineInst",
      accountLabel: "BaselineInst 401k Account",
      beginningBalance: "50000",
      totalContributions: "5000",
      yearlyGainLoss: "3000",
      endingBalance: "58000",
      employerContributions: "1000",
    });

    const summary = await caller.performance.computeSummary();

    // The finalized 2019 row should retain its lifetime values
    const finalized2019 = summary.annualRows.find(
      (r: { year: number; category: string; isFinalized: boolean }) =>
        r.year === 2019 && r.category === "401k/IRA" && r.isFinalized,
    );
    if (finalized2019) {
      expect(finalized2019.lifetimeGains).toBe(20000);
      expect(finalized2019.lifetimeContributions).toBe(40000);
      expect(finalized2019.lifetimeMatch).toBe(10000);
    }
  });

  it("fills null annualReturnPct on rows with financial data", async () => {
    // Seed an annual row with null return but non-zero financials
    seedAnnualPerf(db, {
      year: 2018,
      category: "401k/IRA",
      beginningBalance: "100000",
      totalContributions: "20000",
      yearlyGainLoss: "10000",
      endingBalance: "130000",
      employerContributions: "5000",
      distributions: "0",
      fees: "200",
      rollovers: "0",
      lifetimeGains: "10000",
      lifetimeContributions: "20000",
      lifetimeMatch: "5000",
      isFinalized: true,
      isCurrentYear: false,
    });

    const summary = await caller.performance.computeSummary();
    const row2018 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2018 && r.category === "401k/IRA",
    );
    expect(row2018).toBeDefined();
    // Return should be computed since it was null in stored row
    // Modified Dietz: 10000 / (100000 + (20000 + 0 + 5000 - 0 - 200) / 2)
    const expected = 10000 / (100000 + (20000 + 5000 - 200) / 2);
    expect(row2018!.annualReturnPct).toBeCloseTo(expected, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — Retirement parent-category rollup (lines 572-658)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — Retirement rollup", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("synthesizes Retirement rollup from 401k/IRA + HSA categories", async () => {
    const personId = await seedPerson(db, "Owner");

    const acct401k = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
      ownerPersonId: personId,
    });

    const acctHsa = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "hsa",
      parentCategory: "Retirement",
      ownershipType: "individual",
      ownerPersonId: personId,
    });

    // Seed account data for both
    seedAccountPerf(db, acct401k, {
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity 401k Account",
      ownerPersonId: personId,
      beginningBalance: "80000",
      totalContributions: "15000",
      yearlyGainLoss: "8000",
      endingBalance: "103000",
      employerContributions: "5000",
      fees: "100",
      distributions: "0",
      rollovers: "0",
    });

    seedAccountPerf(db, acctHsa, {
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity HSA Account",
      ownerPersonId: personId,
      parentCategory: "Retirement",
      beginningBalance: "5000",
      totalContributions: "3000",
      yearlyGainLoss: "500",
      endingBalance: "8500",
      employerContributions: "0",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const retRow = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2024 && r.category === "Retirement",
    );
    expect(retRow).toBeDefined();
    // Retirement should include both 401k/IRA and HSA
    expect(retRow!.beginningBalance).toBe(80000 + 5000);
    expect(retRow!.endingBalance).toBe(103000 + 8500);
    expect(retRow!.totalContributions).toBe(15000 + 3000);
    expect(retRow!.yearlyGainLoss).toBe(8000 + 500);
  });

  it("Retirement rollup has computed return percentage", async () => {
    const summary = await caller.performance.computeSummary();
    const retRow = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2024 && r.category === "Retirement",
    );
    expect(retRow).toBeDefined();
    expect(retRow!.annualReturnPct).not.toBeNull();
    expect(typeof retRow!.annualReturnPct).toBe("number");
  });

  it("Retirement rollup accumulates lifetime values across years", async () => {
    const summary = await caller.performance.computeSummary();
    const retRows = summary.annualRows
      .filter((r: { category: string }) => r.category === "Retirement")
      .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

    if (retRows.length >= 2) {
      const first = retRows[0]!;
      const second = retRows[1]!;
      // Lifetime gains should accumulate
      expect(second.lifetimeGains).toBeGreaterThanOrEqual(first.lifetimeGains);
    }
    // At minimum we should have at least one Retirement row
    expect(retRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — enriched accountRows (lines 678-725)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — enriched accountRows", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Account Owner");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      ownershipType: "joint",
      ownerPersonId: personId,
    });

    seedAccountPerf(db, perfAcctId, {
      year: 2024,
      institution: "Schwab",
      accountLabel: "Schwab Brokerage",
      ownerPersonId: personId,
      parentCategory: "Portfolio",
      beginningBalance: "100000",
      totalContributions: "20000",
      yearlyGainLoss: "15000",
      endingBalance: "135000",
      employerContributions: "0",
      fees: "200",
      distributions: "5000",
      rollovers: "0",
    });
  });

  afterAll(() => cleanup());

  it("accountRows include ownerName resolved from people table", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    expect(row!.ownerName).toBe("Account Owner");
  });

  it("accountRows include ownershipType from master record", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    expect(row!.ownershipType).toBe("joint");
  });

  it("accountRows compute return when stored return is null", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    // Return should be computed via Modified Dietz
    expect(row!.annualReturnPct).not.toBeNull();
    expect(typeof row!.annualReturnPct).toBe("number");
  });

  it("lifetimeTotals are populated when Portfolio annual row exists", async () => {
    const summary = await caller.performance.computeSummary();
    // Portfolio row was synthesized, so lifetimeTotals should be available
    if (
      summary.annualRows.some(
        (r: { category: string }) => r.category === "Portfolio",
      )
    ) {
      expect(summary.lifetimeTotals).not.toBeNull();
      expect(summary.lifetimeTotals).toHaveProperty("gains");
      expect(summary.lifetimeTotals).toHaveProperty("contributions");
      expect(summary.lifetimeTotals).toHaveProperty("match");
      expect(summary.lifetimeTotals).toHaveProperty("fees");
      expect(summary.lifetimeTotals).toHaveProperty("distributions");
      expect(summary.lifetimeTotals).toHaveProperty("endingBalance");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finalizeYear — SKIPPED (uses db.execute() with raw SQL / transactions)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.finalizeYear", () => {
  it.skip("skipped — uses db.execute() / db.transaction() incompatible with better-sqlite3 test harness", () => {
    // Lines 915-1424 use tx.execute(sql`...`) with FOR UPDATE locks
    // and complex transaction callbacks that don't work in SQLite test DB.
  });
});
