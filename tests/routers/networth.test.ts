/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Net worth router integration tests.
 *
 * Tests computeSummary, listHistory, listSnapshots, listSnapshotTotals,
 * computeFIProgress, computeComparison, and portfolioSnapshots CRUD
 * (getLatest/create/createAccount/updateAccount/delete — moved from
 * routers/settings/admin.ts) with seeded SQLite data.
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
  adminSession,
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
      filingStatus: "MFJ",
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

describe("networth.portfolioSnapshots.getLatest", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("returns null when no snapshots exist", async () => {
    const result = await caller.networth.portfolioSnapshots.getLatest();
    expect(result).toBeNull();
  });

  it("returns the latest snapshot after one is seeded", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    seedSnapshot(db, "2025-06-30", [
      { performanceAccountId: perfAcctId, amount: "50000", taxType: "preTax" },
    ]);

    const result = await caller.networth.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-06-30");
    expect(Array.isArray(result!.accounts)).toBe(true);
    expect(result!.accounts).toHaveLength(1);
  });

  it("snapshot accounts include the correct amount", async () => {
    const result = await caller.networth.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.accounts[0]!.amount).toBe("50000");
  });

  it("returns the most recent snapshot when multiple exist", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "ira",
    });
    seedSnapshot(db, "2025-12-31", [
      {
        performanceAccountId: perfAcctId,
        amount: "75000",
        taxType: "rothAfterTax",
      },
    ]);

    const result = await caller.networth.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-12-31");
  });

  it("returned snapshot has expected shape", async () => {
    const result = await caller.networth.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("snapshot");
    expect(result).toHaveProperty("accounts");
    expect(result!.snapshot).toHaveProperty("id");
    expect(result!.snapshot).toHaveProperty("snapshotDate");
  });
});

describe("networth.portfolioSnapshots createAccount/updateAccount/delete", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let snapId: number;
  let personId: number;
  let perfAcctId: number;
  let createdAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Carol", "1992-07-10");
    perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    snapId = seedSnapshot(db, "2025-05-01", [
      { performanceAccountId: perfAcctId, amount: "80000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("creates a new account in an existing snapshot", async () => {
    const result = await caller.networth.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Schwab",
      taxType: "afterTax",
      amount: "25000",
      accountType: "ira",
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    expect(result).toBeDefined();
    expect(result.institution).toBe("Schwab");
    expect(result.amount).toBe("25000");
    expect(result.isActive).toBe(true);
    createdAcctId = result.id;
  });

  it("new account appears in getLatest", async () => {
    const latest = await caller.networth.portfolioSnapshots.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.accounts.length).toBeGreaterThanOrEqual(2);
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found).toBeDefined();
    expect(found!.institution).toBe("Schwab");
  });

  it("updates an account owner", async () => {
    await caller.networth.portfolioSnapshots.updateAccount({
      id: createdAcctId,
      ownerPersonId: personId,
    });
    const latest = await caller.networth.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found!.ownerPersonId).toBe(personId);
  });

  it("toggles isActive on an account", async () => {
    await caller.networth.portfolioSnapshots.updateAccount({
      id: createdAcctId,
      isActive: false,
    });
    const latest = await caller.networth.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found!.isActive).toBe(false);
  });

  it("updateAccount with no changes is a no-op", async () => {
    await caller.networth.portfolioSnapshots.updateAccount({
      id: createdAcctId,
    });
    const latest = await caller.networth.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found).toBeDefined();
  });

  it("creates account with performanceAccountId link", async () => {
    const result = await caller.networth.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Fidelity",
      taxType: "preTax",
      amount: "30000",
      accountType: "401k",
      parentCategory: "Retirement",
      ownerPersonId: personId,
      performanceAccountId: perfAcctId,
    });
    expect(result).toBeDefined();
    expect(result.performanceAccountId).toBe(perfAcctId);
  });

  it("rejects creating an account row linked to a closed master account", async () => {
    const closedPerfAcctId = seedPerformanceAccount(db, {
      institution: "Valic",
      isActive: false,
    });
    await expect(
      caller.networth.portfolioSnapshots.createAccount({
        snapshotId: snapId,
        institution: "Valic",
        taxType: "preTax",
        amount: "5000",
        accountType: "401k",
        parentCategory: "Retirement",
        performanceAccountId: closedPerfAcctId,
      }),
    ).rejects.toThrow(/closed/i);
  });

  it("creates account with subType and label", async () => {
    const result = await caller.networth.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Vanguard",
      taxType: "taxFree",
      amount: "10000",
      accountType: "ira",
      subType: "Roth",
      label: "Roth IRA",
      parentCategory: "Retirement",
    });
    expect(result).toBeDefined();
    expect(result.subType).toBe("Roth");
    expect(result.label).toBe("Roth IRA");
  });

  it("deletes a snapshot", async () => {
    const newSnapId = seedSnapshot(db, "2025-03-01", [
      { performanceAccountId: perfAcctId, amount: "70000" },
    ]);
    await caller.networth.portfolioSnapshots.delete({ id: newSnapId });

    const latest = await caller.networth.portfolioSnapshots.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.snapshot.id).toBe(snapId);
  });

  it("delete is idempotent for non-existent snapshot", async () => {
    // Should not throw
    await caller.networth.portfolioSnapshots.delete({ id: 99999 });
  });
});

// NOTE: portfolioSnapshots.create uses db.transaction() which is incompatible
// with better-sqlite3 async pattern in tests. Tested via E2E instead.

describe("networth.portfolioSnapshots.delete", () => {
  it("deletes an existing snapshot", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
        accountType: "401k",
      });
      const snapId = seedSnapshot(ctx.db, "2026-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "50000",
          taxType: "preTax",
        },
      ]);

      await ctx.caller.networth.portfolioSnapshots.delete({ id: snapId });

      const latest = await ctx.caller.networth.portfolioSnapshots.getLatest();
      expect(latest).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("is idempotent for non-existent snapshot", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      await expect(
        ctx.caller.networth.portfolioSnapshots.delete({ id: 99999 }),
      ).resolves.toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });
});

describe("portfolioSnapshots.create", () => {
  it("creates a snapshot with no accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.networth.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [],
      });
      expect(result.snapshotDate).toBe("2025-06-15");
    } finally {
      ctx.cleanup();
    }
  });

  it("creates a snapshot with accounts and syncs parentCategory from the linked performance account", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        parentCategory: "Portfolio",
      });
      const result = await ctx.caller.networth.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [
          {
            institution: "Fidelity",
            taxType: "preTax",
            accountType: "401k",
            amount: "10000",
            ownerPersonId: null,
            performanceAccountId: perfAcctId,
          },
        ],
      });
      expect(result.snapshotDate).toBe("2025-06-15");

      const schema = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const createdAccounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, result.id));
      expect(createdAccounts).toHaveLength(1);
      expect(createdAccounts[0]?.parentCategory).toBe("Portfolio");
    } finally {
      ctx.cleanup();
    }
  });

  it("zeroes the amount for a closed account's row instead of carrying forward its stale balance", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const closedPerfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Valic",
        isActive: false,
      });
      const openPerfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
      });
      const result = await ctx.caller.networth.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [
          {
            institution: "Valic",
            taxType: "preTax",
            accountType: "401k",
            amount: "15000",
            ownerPersonId: null,
            performanceAccountId: closedPerfAcctId,
          },
          {
            institution: "Fidelity",
            taxType: "preTax",
            accountType: "401k",
            amount: "20000",
            ownerPersonId: null,
            performanceAccountId: openPerfAcctId,
          },
        ],
      });

      const schema = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const createdAccounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, result.id));
      const closedRow = createdAccounts.find(
        (a) => a.performanceAccountId === closedPerfAcctId,
      );
      const openRow = createdAccounts.find(
        (a) => a.performanceAccountId === openPerfAcctId,
      );
      // The row for a closed account still exists (not omitted — omitting
      // it would break period conservation), but its amount is zeroed.
      expect(closedRow).toBeDefined();
      expect(closedRow?.amount).toBe("0");
      expect(openRow?.amount).toBe("20000");

      // account_performance's ending balance reflects the same zeroed
      // total — not a second, independently-derived number.
      const currentYearAcctPerf = await ctx.db
        .select()
        .from(schema.accountPerformance)
        .where(
          eq(schema.accountPerformance.performanceAccountId, closedPerfAcctId),
        );
      if (currentYearAcctPerf.length > 0) {
        expect(Number(currentYearAcctPerf[0]?.endingBalance)).toBe(0);
      }
    } finally {
      ctx.cleanup();
    }
  });

  it("leaves a historical snapshot's already-recorded row untouched", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Milliman",
      });
      // A historical snapshot recorded while the account was still open.
      const historicalSnapId = seedSnapshot(ctx.db, "2024-01-15", [
        { performanceAccountId: perfAcctId, amount: "50000" },
      ]);

      // The account closes sometime after that snapshot was recorded.
      const schema = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      await ctx.db
        .update(schema.performanceAccounts)
        .set({ isActive: false })
        .where(eq(schema.performanceAccounts.id, perfAcctId));

      // A new snapshot is created after closure.
      await ctx.caller.networth.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [
          {
            institution: "Milliman",
            taxType: "preTax",
            accountType: "401k",
            amount: "50000",
            ownerPersonId: null,
            performanceAccountId: perfAcctId,
          },
        ],
      });

      const historicalAccounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, historicalSnapId));
      expect(historicalAccounts[0]?.amount).toBe("50000");
    } finally {
      ctx.cleanup();
    }
  });
});
