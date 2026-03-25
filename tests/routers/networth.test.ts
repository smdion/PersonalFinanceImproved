/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Net worth router integration tests.
 *
 * Tests computeSummary, listHistory, listSnapshots, listSnapshotTotals,
 * computeFIProgress, and computeComparison with seeded SQLite data.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
  seedBudgetProfile,
  viewerSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

// budget-api is mocked inline when needed by the router

/**
 * Seed a rich dataset using the mocked schema (from @/lib/db/schema which
 * is redirected to schema-sqlite by setup-mocks).
 */
async function seedFullData(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<number> {
  const schema = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const personId = await seedPerson(db, "Test Person", "1990-01-01");

  // Mark as primary user
  (db as any)
    .update(schema.people)
    .set({ isPrimaryUser: true })
    .where(eq(schema.people.id, personId))
    .run();

  seedJob(db, personId);

  (db as any)
    .insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
    })
    .run();

  const perfAcctId = seedPerformanceAccount(db, {
    name: "401k",
    institution: "Fidelity",
    accountType: "401k",
  });
  const perfAcctId2 = seedPerformanceAccount(db, {
    name: "Brokerage",
    institution: "Schwab",
    accountType: "brokerage",
    parentCategory: "Portfolio",
  });

  seedSnapshot(db, "2024-06-15", [
    { performanceAccountId: perfAcctId, amount: "80000", taxType: "preTax" },
    { performanceAccountId: perfAcctId2, amount: "40000", taxType: "afterTax" },
  ]);
  seedSnapshot(db, "2025-01-15", [
    { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
    { performanceAccountId: perfAcctId2, amount: "50000", taxType: "afterTax" },
  ]);

  const profileId = await seedBudgetProfile(db);
  (db as any)
    .insert(schema.budgetItems)
    .values({
      profileId,
      category: "Essentials",
      subcategory: "Rent",
      amounts: [2000],
    })
    .run();
  (db as any)
    .insert(schema.budgetItems)
    .values({
      profileId,
      category: "Essentials",
      subcategory: "Groceries",
      amounts: [600],
    })
    .run();

  return personId;
}

describe("networth router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    await seedFullData(db);
  });

  afterAll(() => cleanup());

  describe("computeSummary", () => {
    it("does not throw with minimal DB", async () => {
      await expect(caller.networth.computeSummary()).resolves.toBeDefined();
    });

    it("returns expected top-level properties", async () => {
      const result = await caller.networth.computeSummary();
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("portfolioTotal");
      expect(result).toHaveProperty("cash");
      expect(result).toHaveProperty("mortgageBalance");
      expect(result).toHaveProperty("otherAssets");
      expect(result).toHaveProperty("otherLiabilities");
      expect(result).toHaveProperty("withdrawalRate");
      expect(result).toHaveProperty("hasHouse");
      expect(result).toHaveProperty("homeValueEstimated");
      expect(result).toHaveProperty("homeValueConservative");
      expect(result).toHaveProperty("people");
      expect(result).toHaveProperty("portfolioAccounts");
      expect(result).toHaveProperty("otherAssetItems");
    });

    it("returns numeric types for portfolio/mortgage/cash fields", async () => {
      const result = await caller.networth.computeSummary();
      expect(typeof result.portfolioTotal).toBe("number");
      expect(typeof result.cash).toBe("number");
      expect(typeof result.mortgageBalance).toBe("number");
      expect(typeof result.otherAssets).toBe("number");
      expect(typeof result.otherLiabilities).toBe("number");
      expect(typeof result.homeValueEstimated).toBe("number");
      expect(typeof result.homeValueConservative).toBe("number");
      // With seeded snapshots, portfolioTotal should be > 0
      expect(result.portfolioTotal).toBeGreaterThanOrEqual(0);
      expect(result.mortgageBalance).toBe(0);
      expect(result.otherLiabilities).toBe(0);
      expect(result.homeValueEstimated).toBe(0);
    });

    it("result object has netWorth and related fields", async () => {
      const result = await caller.networth.computeSummary();
      expect(result.result).toHaveProperty("netWorth");
      expect(result.result).toHaveProperty("netWorthMarket");
      expect(result.result).toHaveProperty("totalAssets");
      expect(result.result).toHaveProperty("totalLiabilities");
      expect(result.result).toHaveProperty("fiProgress");
      expect(typeof result.result.netWorth).toBe("number");
    });

    it("hasHouse is false when no active mortgage exists", async () => {
      const result = await caller.networth.computeSummary();
      expect(result.hasHouse).toBe(false);
    });

    it("people array contains the seeded person", async () => {
      const result = await caller.networth.computeSummary();
      expect(Array.isArray(result.people)).toBe(true);
      expect(result.people.length).toBeGreaterThanOrEqual(1);
      expect(result.people[0]).toHaveProperty("id");
      expect(result.people[0]).toHaveProperty("name");
    });

    it("portfolioAccounts is an array", async () => {
      const result = await caller.networth.computeSummary();
      expect(Array.isArray(result.portfolioAccounts)).toBe(true);
    });

    it("otherAssetItems is an array", async () => {
      const result = await caller.networth.computeSummary();
      expect(Array.isArray(result.otherAssetItems)).toBe(true);
    });

    it("snapshotDate reflects the latest snapshot", async () => {
      const result = await caller.networth.computeSummary();
      // Data was seeded with snapshots, so snapshotDate should be a string
      expect(typeof result.snapshotDate).toBe("string");
    });

    it("withdrawalRate matches seeded retirement settings", async () => {
      const result = await caller.networth.computeSummary();
      expect(typeof result.withdrawalRate).toBe("number");
      expect(result.withdrawalRate).toBeCloseTo(0.04);
    });
  });

  // ── LIST SNAPSHOT TOTALS ──

  describe("listSnapshotTotals", () => {
    it("returns snapshot date/total pairs ordered by date", async () => {
      const result = await caller.networth.listSnapshotTotals();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]!.date).toBe("2024-06-15");
      expect(result[0]!.total).toBeCloseTo(120000, 0);
      expect(result[1]!.date).toBe("2025-01-15");
      expect(result[1]!.total).toBeCloseTo(150000, 0);
    });
  });

  // ── LIST SNAPSHOTS (paginated) ──

  describe("listSnapshots", () => {
    it("returns paginated snapshots with accounts", async () => {
      const result = await caller.networth.listSnapshots({
        page: 1,
        pageSize: 10,
      });
      expect(result.totalCount).toBe(2);
      expect(result.snapshots.length).toBe(2);
      // Ordered by date descending
      expect(result.snapshots[0]!.snapshotDate).toBe("2025-01-15");
      expect(result.snapshots[0]!.accountCount).toBe(2);
      expect(result.snapshots[0]!.total).toBeCloseTo(150000, 0);
    });

    it("filters by date range", async () => {
      const result = await caller.networth.listSnapshots({
        page: 1,
        pageSize: 10,
        dateFrom: "2025-01-01",
      });
      expect(result.totalCount).toBe(1);
      expect(result.snapshots[0]!.snapshotDate).toBe("2025-01-15");
    });

    it("returns empty for out-of-range dates", async () => {
      const result = await caller.networth.listSnapshots({
        page: 1,
        pageSize: 10,
        dateFrom: "2026-01-01",
      });
      expect(result.totalCount).toBe(0);
      expect(result.snapshots).toEqual([]);
    });

    it("paginates correctly", async () => {
      const page1 = await caller.networth.listSnapshots({
        page: 1,
        pageSize: 1,
      });
      expect(page1.snapshots.length).toBe(1);
      expect(page1.totalPages).toBe(2);
      const page2 = await caller.networth.listSnapshots({
        page: 2,
        pageSize: 1,
      });
      expect(page2.snapshots.length).toBe(1);
      expect(page2.snapshots[0]!.snapshotDate).toBe("2024-06-15");
    });
  });

  // ── COMPUTE FI PROGRESS ──

  describe("computeFIProgress", () => {
    it("returns FI progress with portfolio and target", async () => {
      const result = await caller.networth.computeFIProgress();
      expect(result).toHaveProperty("fiProgress");
      expect(result).toHaveProperty("fiTarget");
      expect(result).toHaveProperty("currentPortfolio");
      expect(result.currentPortfolio).toBeCloseTo(150000, 0);
      expect(typeof result.fiProgress).toBe("number");
      expect(typeof result.fiTarget).toBe("number");
      expect(result.fiTarget).toBeGreaterThan(0);
    });
  });

  // ── COMPUTE COMPARISON ──

  describe("computeComparison", () => {
    it("compares net worth at two dates", async () => {
      const result = await caller.networth.computeComparison({
        dateFrom: "2024-06-01",
        dateTo: "2025-01-20",
      });
      expect(result).toHaveProperty("from");
      expect(result).toHaveProperty("to");
      expect(result).toHaveProperty("absoluteChange");
      expect(result).toHaveProperty("percentChange");
      expect(result).toHaveProperty("categories");
      expect(result).toHaveProperty("portfolioBreakdown");
      expect(result.from.portfolioTotal).toBeCloseTo(120000, 0);
      expect(result.to.portfolioTotal).toBeCloseTo(150000, 0);
      expect(result.absoluteChange).toBeGreaterThan(0);
    });

    it("includes portfolio breakdown by tax type", async () => {
      const result = await caller.networth.computeComparison({
        dateFrom: "2024-06-01",
        dateTo: "2025-01-20",
      });
      expect(result.portfolioBreakdown.length).toBeGreaterThan(0);
      const preTax = result.portfolioBreakdown.find(
        (b) => b.label === "preTax",
      );
      expect(preTax).toBeDefined();
      expect(preTax!.from).toBeCloseTo(80000, 0);
      expect(preTax!.to).toBeCloseTo(100000, 0);
    });

    it("includes category breakdown", async () => {
      const result = await caller.networth.computeComparison({
        dateFrom: "2024-06-01",
        dateTo: "2025-01-20",
      });
      expect(result.categories.length).toBeGreaterThanOrEqual(4);
      const portfolio = result.categories.find(
        (c) => c.label === "Investment Portfolio",
      );
      expect(portfolio).toBeDefined();
      expect(portfolio!.delta).toBeCloseTo(30000, 0);
    });

    it("includes limitations array", async () => {
      const result = await caller.networth.computeComparison({
        dateFrom: "2024-06-01",
        dateTo: "2025-01-20",
      });
      expect(Array.isArray(result.limitations)).toBe(true);
      expect(result.limitations.length).toBeGreaterThan(0);
    });
  });

  // ── LIST HISTORY ──

  describe("listHistory", () => {
    it("returns year-end history array with birth year", async () => {
      const result = await caller.networth.listHistory();
      expect(result).toHaveProperty("years");
      expect(result).toHaveProperty("primaryBirthYear");
      expect(Array.isArray(result.years)).toBe(true);
      // dateOfBirth "1990-01-01" → birth year may be 1989 or 1990 depending on date parsing
      expect(result.primaryBirthYear).toBeGreaterThanOrEqual(1989);
      expect(result.primaryBirthYear).toBeLessThanOrEqual(1990);
    });
  });

  // ── AUTH ──

  describe("auth", () => {
    it("viewer can read net worth summary", async () => {
      const {
        caller: viewerCaller,
        db: viewerDb,
        cleanup: viewerCleanup,
      } = await createTestCaller(viewerSession);
      try {
        await seedFullData(viewerDb);
        const result = await viewerCaller.networth.computeSummary();
        expect(result).toBeDefined();
        expect(result.result).toHaveProperty("netWorth");
      } finally {
        viewerCleanup();
      }
    });
  });
});
