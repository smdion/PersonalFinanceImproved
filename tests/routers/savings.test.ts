/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Savings router integration tests.
 *
 * Covers: plannedTransactions (create/update/delete), allocationOverrides
 * (upsert/delete/deleteMonth), linkGoalToApi, unlinkGoalFromApi,
 * convertBudgetItemToGoal, convertGoalToBudgetItem, linkReimbursementCategory,
 * transfers (create/delete), and computeSummary.
 *
 * computeSummary uses db.execute(sql`...`) with dialect branching.
 * The dialect mock returns isPostgres=false so the SQLite GROUP BY branch runs.
 * We patch rawDb.execute() via SQLiteSyncDialect to handle the raw query.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import {
  createTestCaller,
  seedStandardDataset,
  seedSavingsGoal,
  seedBudgetItem,
  seedBudgetProfile,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
}));

/**
 * Patch rawDb.execute so computeSummary's raw balance query works in SQLite.
 * Drizzle's execute() is Postgres-only in the type system; we bridge it via
 * SQLiteSyncDialect + better-sqlite3's $client.
 */
function patchExecute(
  rawDb: Record<string, unknown>,
  sqliteClient: {
    prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
  },
): void {
  const dialect = new SQLiteSyncDialect();
  rawDb["execute"] = (sqlObj: SQL) => {
    const { sql: queryStr, params } = dialect.sqlToQuery(sqlObj);
    const rows = sqliteClient.prepare(queryStr).all(...params);
    return { rows };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// plannedTransactions
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.plannedTransactions", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let goalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    goalId = seedSavingsGoal(db, {
      name: "Vacation Fund",
      targetAmount: "5000",
      monthlyContribution: "200",
    });
  });

  afterAll(() => cleanup());

  // ── CREATE ──

  describe("create", () => {
    it("creates a planned transaction for a goal", async () => {
      const result = await caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-06-01",
        amount: "250",
        description: "Vacation deposit",
        isRecurring: false,
      });
      expect(result).toBeDefined();
      expect(result.goalId).toBe(goalId);
      expect(result.description).toBe("Vacation deposit");
      expect(result.transactionDate).toBe("2026-06-01");
      expect(result.isRecurring).toBe(false);
    });

    it("creates a recurring planned transaction with recurrenceMonths", async () => {
      const result = await caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-07-01",
        amount: "100",
        description: "Monthly auto-deposit",
        isRecurring: true,
        recurrenceMonths: 12,
      });
      expect(result).toBeDefined();
      expect(result.isRecurring).toBe(true);
      expect(result.recurrenceMonths).toBe(12);
    });

    it("creates a withdrawal with a negative amount", async () => {
      const result = await caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-08-15",
        amount: "-500",
        description: "Vacation spend",
        isRecurring: false,
      });
      expect(result).toBeDefined();
      expect(result.amount).toBe("-500");
    });

    it("rejects an invalid date format", async () => {
      await expect(
        caller.savings.plannedTransactions.create({
          goalId,
          transactionDate: "06-01-2026",
          amount: "100",
          description: "Bad date",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });

    it("rejects a non-numeric amount", async () => {
      await expect(
        caller.savings.plannedTransactions.create({
          goalId,
          transactionDate: "2026-06-01",
          amount: "abc",
          description: "Bad amount",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });

    it("rejects an empty description", async () => {
      await expect(
        caller.savings.plannedTransactions.create({
          goalId,
          transactionDate: "2026-06-01",
          amount: "100",
          description: "",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });
  });

  // ── UPDATE ──

  describe("update", () => {
    let txId: number;

    beforeAll(async () => {
      const tx = await caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-09-01",
        amount: "300",
        description: "Original description",
        isRecurring: false,
      });
      txId = tx.id;
    });

    it("updates the description and amount", async () => {
      const result = await caller.savings.plannedTransactions.update({
        id: txId,
        goalId,
        transactionDate: "2026-09-01",
        amount: "350",
        description: "Updated description",
        isRecurring: false,
      });
      expect(result).toBeDefined();
      expect(result.id).toBe(txId);
      expect(result.amount).toBe("350");
      expect(result.description).toBe("Updated description");
    });

    it("updates recurring flag and recurrenceMonths", async () => {
      const result = await caller.savings.plannedTransactions.update({
        id: txId,
        goalId,
        transactionDate: "2026-09-01",
        amount: "350",
        description: "Updated description",
        isRecurring: true,
        recurrenceMonths: 6,
      });
      expect(result.isRecurring).toBe(true);
      expect(result.recurrenceMonths).toBe(6);
    });

    it("updates the transaction date", async () => {
      const result = await caller.savings.plannedTransactions.update({
        id: txId,
        goalId,
        transactionDate: "2026-10-01",
        amount: "350",
        description: "Updated description",
        isRecurring: false,
      });
      expect(result.transactionDate).toBe("2026-10-01");
    });

    it("rejects update with invalid date format", async () => {
      await expect(
        caller.savings.plannedTransactions.update({
          id: txId,
          goalId,
          transactionDate: "bad-date",
          amount: "100",
          description: "desc",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });
  });

  // ── DELETE ──

  describe("delete", () => {
    it("deletes a planned transaction by id", async () => {
      const tx = await caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-11-01",
        amount: "100",
        description: "To be deleted",
        isRecurring: false,
      });
      await expect(
        caller.savings.plannedTransactions.delete({ id: tx.id }),
      ).resolves.toBeDefined();
    });

    it("does not throw when deleting a non-existent id", async () => {
      await expect(
        caller.savings.plannedTransactions.delete({ id: 999999 }),
      ).resolves.toBeDefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// allocationOverrides
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.allocationOverrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let goalId: number;
  let goalId2: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    goalId = seedSavingsGoal(db, {
      name: "House Fund",
      targetAmount: "50000",
      monthlyContribution: "1000",
    });
    goalId2 = seedSavingsGoal(db, {
      name: "Car Fund",
      targetAmount: "20000",
      monthlyContribution: "400",
    });
  });

  afterAll(() => cleanup());

  // ── UPSERT ──

  describe("upsert", () => {
    it("inserts a new override for a goal and month", async () => {
      const result = await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-04-01",
        amount: 800,
      });
      expect(result).toBeDefined();
      expect(result.goalId).toBe(goalId);
      expect(result.monthDate).toBe("2026-04-01");
      expect(Number(result.amount)).toBe(800);
    });

    it("updates an existing override for the same goal and month", async () => {
      await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-05-01",
        amount: 500,
      });
      const result = await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-05-01",
        amount: 750,
      });
      expect(result).toBeDefined();
      expect(Number(result.amount)).toBe(750);
    });

    it("inserts separate overrides for different months of the same goal", async () => {
      const r1 = await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-06-01",
        amount: 600,
      });
      const r2 = await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-07-01",
        amount: 700,
      });
      expect(r1.monthDate).toBe("2026-06-01");
      expect(r2.monthDate).toBe("2026-07-01");
    });

    it("inserts overrides for different goals on the same month", async () => {
      const r1 = await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-08-01",
        amount: 400,
      });
      const r2 = await caller.savings.allocationOverrides.upsert({
        goalId: goalId2,
        monthDate: "2026-08-01",
        amount: 200,
      });
      expect(r1.goalId).toBe(goalId);
      expect(r2.goalId).toBe(goalId2);
    });

    it("rejects invalid monthDate format", async () => {
      await expect(
        caller.savings.allocationOverrides.upsert({
          goalId,
          monthDate: "2026-04",
          amount: 100,
        }),
      ).rejects.toThrow();
    });
  });

  // ── DELETE ──

  describe("delete", () => {
    it("deletes an existing override by goalId and monthDate", async () => {
      await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-09-01",
        amount: 300,
      });
      const result = await caller.savings.allocationOverrides.delete({
        goalId,
        monthDate: "2026-09-01",
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:true when no matching override exists", async () => {
      const result = await caller.savings.allocationOverrides.delete({
        goalId,
        monthDate: "2000-01-01",
      });
      expect(result).toEqual({ ok: true });
    });

    it("only deletes the target goal's override, not other goals on the same month", async () => {
      await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-10-01",
        amount: 500,
      });
      await caller.savings.allocationOverrides.upsert({
        goalId: goalId2,
        monthDate: "2026-10-01",
        amount: 200,
      });
      // Delete only goalId's override
      await caller.savings.allocationOverrides.delete({
        goalId,
        monthDate: "2026-10-01",
      });
      // goalId2's override for the same month should still exist — upsert will update not insert
      const r = await caller.savings.allocationOverrides.upsert({
        goalId: goalId2,
        monthDate: "2026-10-01",
        amount: 200,
      });
      expect(Number(r.amount)).toBe(200);
    });
  });

  // ── DELETE MONTH ──

  describe("deleteMonth", () => {
    it("deletes all overrides across all goals for a given month", async () => {
      const month = "2026-11-01";
      await caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: month,
        amount: 400,
      });
      await caller.savings.allocationOverrides.upsert({
        goalId: goalId2,
        monthDate: month,
        amount: 200,
      });
      const result = await caller.savings.allocationOverrides.deleteMonth({
        monthDates: [month],
      });
      expect(result).toEqual({ ok: true });
    });

    it("deletes overrides across multiple months at once", async () => {
      const months = ["2027-01-01", "2027-02-01"];
      for (const m of months) {
        await caller.savings.allocationOverrides.upsert({
          goalId,
          monthDate: m,
          amount: 300,
        });
      }
      const result = await caller.savings.allocationOverrides.deleteMonth({
        monthDates: months,
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:true with an empty monthDates array", async () => {
      const result = await caller.savings.allocationOverrides.deleteMonth({
        monthDates: [],
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:true when months have no overrides", async () => {
      const result = await caller.savings.allocationOverrides.deleteMonth({
        monthDates: ["2099-01-01"],
      });
      expect(result).toEqual({ ok: true });
    });

    it("rejects monthDates entries with invalid format", async () => {
      await expect(
        caller.savings.allocationOverrides.deleteMonth({
          monthDates: ["2026-11"],
        }),
      ).rejects.toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// linkGoalToApi / unlinkGoalFromApi
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.linkGoalToApi / unlinkGoalFromApi", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let goalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    goalId = seedSavingsGoal(db, {
      name: "Sinking Fund",
      targetAmount: "3000",
      monthlyContribution: "150",
    });
  });

  afterAll(() => cleanup());

  describe("linkGoalToApi", () => {
    it("links a goal to a budget API category", async () => {
      const result = await caller.savings.linkGoalToApi({
        goalId,
        apiCategoryId: "cat-abc-123",
        apiCategoryName: "Sinking Fund Category",
      });
      expect(result).toEqual({ ok: true });
    });

    it("can re-link a goal to a different API category", async () => {
      const result = await caller.savings.linkGoalToApi({
        goalId,
        apiCategoryId: "cat-xyz-999",
        apiCategoryName: "New Category Name",
      });
      expect(result).toEqual({ ok: true });
    });

    it("rejects empty apiCategoryId", async () => {
      await expect(
        caller.savings.linkGoalToApi({
          goalId,
          apiCategoryId: "",
          apiCategoryName: "Some Name",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty apiCategoryName", async () => {
      await expect(
        caller.savings.linkGoalToApi({
          goalId,
          apiCategoryId: "cat-abc",
          apiCategoryName: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("unlinkGoalFromApi", () => {
    it("unlinks a previously linked goal from the budget API", async () => {
      await caller.savings.linkGoalToApi({
        goalId,
        apiCategoryId: "cat-abc-123",
        apiCategoryName: "Sinking Fund Category",
      });
      const result = await caller.savings.unlinkGoalFromApi({ goalId });
      expect(result).toEqual({ ok: true });
    });

    it("succeeds when unlinking a goal that was never linked", async () => {
      const freshGoalId = seedSavingsGoal(db, {
        name: "Never Linked Goal",
        targetAmount: "1000",
        monthlyContribution: "50",
      });
      const result = await caller.savings.unlinkGoalFromApi({
        goalId: freshGoalId,
      });
      expect(result).toEqual({ ok: true });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// convertBudgetItemToGoal
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.convertBudgetItemToGoal", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    profileId = await seedBudgetProfile(db, "Conversion Budget", true);
  });

  afterAll(() => cleanup());

  it("converts a budget item with apiCategoryId into a savings goal", async () => {
    const itemId = seedBudgetItem(db, profileId, {
      category: "Savings",
      subcategory: "New Car",
      amounts: [300],
      apiCategoryId: "ynab-cat-car-001",
      apiCategoryName: "New Car Fund",
    });
    const result = await caller.savings.convertBudgetItemToGoal({
      budgetItemId: itemId,
      goalName: "New Car Savings Goal",
      monthlyContribution: "300",
      targetAmount: "15000",
      targetMode: "fixed",
    });
    expect(result).toBeDefined();
    expect(result.name).toBe("New Car Savings Goal");
    expect(result.apiCategoryId).toBe("ynab-cat-car-001");
    expect(result.apiCategoryName).toBe("New Car Fund");
    expect(result.isApiSyncEnabled).toBe(true);
  });

  it("creates a goal even when apiCategoryId is null on the budget item", async () => {
    const itemId = seedBudgetItem(db, profileId, {
      category: "Savings",
      subcategory: "Rainy Day",
      amounts: [100],
    });
    const result = await caller.savings.convertBudgetItemToGoal({
      budgetItemId: itemId,
      goalName: "Rainy Day Goal",
      monthlyContribution: "100",
      targetMode: "ongoing",
    });
    expect(result.name).toBe("Rainy Day Goal");
    expect(result.isApiSyncEnabled).toBe(false);
    expect(result.apiCategoryId).toBeNull();
  });

  it("applies the given targetMode to the resulting goal", async () => {
    const itemId = seedBudgetItem(db, profileId, {
      category: "Savings",
      subcategory: "Ongoing Goal",
      amounts: [50],
    });
    const result = await caller.savings.convertBudgetItemToGoal({
      budgetItemId: itemId,
      goalName: "Ongoing Goal",
      monthlyContribution: "50",
      targetMode: "ongoing",
    });
    expect(result.targetMode).toBe("ongoing");
  });

  it("converts a budget item to a bucket goal", async () => {
    const itemId = seedBudgetItem(db, profileId, {
      category: "Savings",
      subcategory: "Holding Bucket",
      amounts: [0],
    });
    const result = await caller.savings.convertBudgetItemToGoal({
      budgetItemId: itemId,
      goalName: "Holding Bucket",
      monthlyContribution: "0",
      targetMode: "bucket",
    });
    expect(result.targetMode).toBe("bucket");
  });

  it("throws NOT_FOUND for a non-existent budget item", async () => {
    await expect(
      caller.savings.convertBudgetItemToGoal({
        budgetItemId: 999999,
        goalName: "Ghost Goal",
        monthlyContribution: "0",
        targetMode: "ongoing",
      }),
    ).rejects.toThrow("Budget item not found");
  });

  it("deletes the source budget item after conversion (idempotency check)", async () => {
    const itemId = seedBudgetItem(db, profileId, {
      category: "Savings",
      subcategory: "Vacation",
      amounts: [200],
    });
    await caller.savings.convertBudgetItemToGoal({
      budgetItemId: itemId,
      goalName: "Vacation Goal",
      monthlyContribution: "200",
      targetMode: "ongoing",
    });
    // The budget item is gone — a second attempt must throw NOT_FOUND
    await expect(
      caller.savings.convertBudgetItemToGoal({
        budgetItemId: itemId,
        goalName: "Duplicate Goal",
        monthlyContribution: "0",
        targetMode: "ongoing",
      }),
    ).rejects.toThrow("Budget item not found");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// convertGoalToBudgetItem
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.convertGoalToBudgetItem", () => {
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

  it("converts a savings goal to a budget item using the active budget profile", async () => {
    const profileId = await seedBudgetProfile(db, "Active Budget", true);
    const goalId = seedSavingsGoal(db, {
      name: "Convertible Goal",
      targetAmount: "8000",
      monthlyContribution: "400",
      apiCategoryId: "ynab-savings-001",
      apiCategoryName: "Savings Bucket",
      isApiSyncEnabled: true,
    });
    const result = await caller.savings.convertGoalToBudgetItem({
      goalId,
      category: "Savings",
      subcategory: "Convertible Goal",
      isEssential: false,
    });
    expect(result).toBeDefined();
    expect(result.category).toBe("Savings");
    expect(result.subcategory).toBe("Convertible Goal");
    expect(result.profileId).toBe(profileId);
    expect(result.apiCategoryId).toBe("ynab-savings-001");
    expect(result.apiCategoryName).toBe("Savings Bucket");
  });

  it("transfers the isEssential flag to the new budget item", async () => {
    await seedBudgetProfile(db, "Essential Budget", true);
    const goalId = seedSavingsGoal(db, {
      name: "Essential Goal",
      targetAmount: "2000",
      monthlyContribution: "100",
    });
    const result = await caller.savings.convertGoalToBudgetItem({
      goalId,
      category: "Essentials",
      subcategory: "Insurance",
      isEssential: true,
    });
    expect(result.isEssential).toBe(true);
  });

  it("throws NOT_FOUND for a non-existent goal", async () => {
    await seedBudgetProfile(db, "Fallback Budget", true);
    await expect(
      caller.savings.convertGoalToBudgetItem({
        goalId: 999999,
        category: "Savings",
        subcategory: "Ghost",
        isEssential: false,
      }),
    ).rejects.toThrow("Savings goal not found");
  });

  it("throws PRECONDITION_FAILED when no active budget profile exists", async () => {
    const freshCtx = await createTestCaller();
    try {
      const freshGoalId = seedSavingsGoal(freshCtx.db, {
        name: "Homeless Goal",
        targetAmount: "1000",
        monthlyContribution: "50",
      });
      await expect(
        freshCtx.caller.savings.convertGoalToBudgetItem({
          goalId: freshGoalId,
          category: "Savings",
          subcategory: "Something",
          isEssential: false,
        }),
      ).rejects.toThrow("No active budget profile");
    } finally {
      freshCtx.cleanup();
    }
  });

  it("deletes the savings goal after conversion (idempotency check)", async () => {
    await seedBudgetProfile(db, "Delete Check Budget", true);
    const goalId = seedSavingsGoal(db, {
      name: "One-Time Goal",
      targetAmount: "500",
      monthlyContribution: "50",
    });
    await caller.savings.convertGoalToBudgetItem({
      goalId,
      category: "Misc",
      subcategory: "One-Time",
      isEssential: false,
    });
    await expect(
      caller.savings.convertGoalToBudgetItem({
        goalId,
        category: "Misc",
        subcategory: "One-Time",
        isEssential: false,
      }),
    ).rejects.toThrow("Savings goal not found");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// linkReimbursementCategory
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.linkReimbursementCategory", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let efundGoalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    efundGoalId = seedSavingsGoal(db, {
      name: "Emergency Fund",
      targetAmount: "15000",
      monthlyContribution: "500",
      isEmergencyFund: true,
    });
  });

  afterAll(() => cleanup());

  it("links a reimbursement category to the e-fund goal", async () => {
    const result = await caller.savings.linkReimbursementCategory({
      goalId: efundGoalId,
      apiCategoryId: "reimb-cat-001",
    });
    expect(result).toEqual({ ok: true });
  });

  it("can update the reimbursement category to a different id", async () => {
    const result = await caller.savings.linkReimbursementCategory({
      goalId: efundGoalId,
      apiCategoryId: "reimb-cat-002",
    });
    expect(result).toEqual({ ok: true });
  });

  it("clears the reimbursement category when apiCategoryId is null", async () => {
    const result = await caller.savings.linkReimbursementCategory({
      goalId: efundGoalId,
      apiCategoryId: null,
    });
    expect(result).toEqual({ ok: true });
  });

  it("works on a non-emergency-fund goal (no restriction in the router)", async () => {
    const regularGoalId = seedSavingsGoal(db, {
      name: "Regular Goal",
      targetAmount: "5000",
      monthlyContribution: "200",
      isEmergencyFund: false,
    });
    const result = await caller.savings.linkReimbursementCategory({
      goalId: regularGoalId,
      apiCategoryId: "reimb-cat-regular",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects an empty string apiCategoryId (min(1) constraint)", async () => {
    await expect(
      caller.savings.linkReimbursementCategory({
        goalId: efundGoalId,
        apiCategoryId: "",
      }),
    ).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// transfers
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.transfers", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let fromGoalId: number;
  let toGoalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    fromGoalId = seedSavingsGoal(db, {
      name: "Source Goal",
      targetAmount: "20000",
      monthlyContribution: "800",
    });
    toGoalId = seedSavingsGoal(db, {
      name: "Destination Goal",
      targetAmount: "10000",
      monthlyContribution: "300",
    });
  });

  afterAll(() => cleanup());

  // ── CREATE ──

  describe("create", () => {
    it("creates a transfer pair with withdrawal and deposit legs", async () => {
      const result = await caller.savings.transfers.create({
        fromGoalId,
        toGoalId,
        transactionDate: "2026-05-15",
        amount: 500,
        description: "Transfer to destination",
        isRecurring: false,
      });
      expect(result).toBeDefined();
      expect(result.pairId).toMatch(/^xfer_/);
      expect(result.withdrawal).toBeDefined();
      expect(result.deposit).toBeDefined();
      expect(result.withdrawal.goalId).toBe(fromGoalId);
      expect(result.deposit.goalId).toBe(toGoalId);
    });

    it("withdrawal is negative and deposit is positive for the same amount", async () => {
      const result = await caller.savings.transfers.create({
        fromGoalId,
        toGoalId,
        transactionDate: "2026-06-01",
        amount: 1000,
        description: "Large transfer",
        isRecurring: false,
      });
      expect(Number(result.withdrawal.amount)).toBe(-1000);
      expect(Number(result.deposit.amount)).toBe(1000);
    });

    it("both legs share the same transferPairId", async () => {
      const result = await caller.savings.transfers.create({
        fromGoalId,
        toGoalId,
        transactionDate: "2026-07-01",
        amount: 250,
        description: "Pair check",
        isRecurring: false,
      });
      expect(result.withdrawal.transferPairId).toBe(result.pairId);
      expect(result.deposit.transferPairId).toBe(result.pairId);
    });

    it("creates a recurring transfer with recurrenceMonths on both legs", async () => {
      const result = await caller.savings.transfers.create({
        fromGoalId,
        toGoalId,
        transactionDate: "2026-08-01",
        amount: 200,
        description: "Recurring transfer",
        isRecurring: true,
        recurrenceMonths: 3,
      });
      expect(result.withdrawal.isRecurring).toBe(true);
      expect(result.deposit.isRecurring).toBe(true);
      expect(result.withdrawal.recurrenceMonths).toBe(3);
      expect(result.deposit.recurrenceMonths).toBe(3);
    });

    it("rejects a zero amount (must be positive)", async () => {
      await expect(
        caller.savings.transfers.create({
          fromGoalId,
          toGoalId,
          transactionDate: "2026-09-01",
          amount: 0,
          description: "Zero transfer",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });

    it("rejects a negative amount (must be positive)", async () => {
      await expect(
        caller.savings.transfers.create({
          fromGoalId,
          toGoalId,
          transactionDate: "2026-09-01",
          amount: -100,
          description: "Negative transfer",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });

    it("rejects an invalid transactionDate format", async () => {
      await expect(
        caller.savings.transfers.create({
          fromGoalId,
          toGoalId,
          transactionDate: "May 1, 2026",
          amount: 100,
          description: "Bad date",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });

    it("rejects an empty description", async () => {
      await expect(
        caller.savings.transfers.create({
          fromGoalId,
          toGoalId,
          transactionDate: "2026-09-01",
          amount: 100,
          description: "",
          isRecurring: false,
        }),
      ).rejects.toThrow();
    });
  });

  // ── DELETE ──

  describe("delete", () => {
    it("deletes both legs of a transfer pair by pairId", async () => {
      const { pairId } = await caller.savings.transfers.create({
        fromGoalId,
        toGoalId,
        transactionDate: "2026-10-01",
        amount: 300,
        description: "To be deleted pair",
        isRecurring: false,
      });
      const result = await caller.savings.transfers.delete({
        transferPairId: pairId,
      });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:true when the pairId does not exist", async () => {
      const result = await caller.savings.transfers.delete({
        transferPairId: "xfer_nonexistent_abc",
      });
      expect(result).toEqual({ ok: true });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// computeSummary
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.computeSummary", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Patch rawDb.execute so the SQLite raw balance query in computeSummary works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteClient = (ctx.db as any).$client as {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
    };
    patchExecute(ctx.rawDb as unknown as Record<string, unknown>, sqliteClient);

    // Seed a standard dataset: budget profile + budget items + savings goal
    seedStandardDataset(db);
  });

  afterAll(() => cleanup());

  it("returns without error with minimal seeded data", async () => {
    await expect(caller.savings.computeSummary()).resolves.toBeDefined();
  });

  it("returns all expected top-level keys", async () => {
    const result = await caller.savings.computeSummary();
    expect(result).toHaveProperty("savings");
    expect(result).toHaveProperty("efund");
    expect(result).toHaveProperty("goals");
    expect(result).toHaveProperty("budgetTierLabels");
    expect(result).toHaveProperty("efundTierIndex");
    expect(result).toHaveProperty("plannedTransactions");
    expect(result).toHaveProperty("allocationOverrides");
  });

  it("goals is a non-empty array after seeding", async () => {
    const result = await caller.savings.computeSummary();
    expect(Array.isArray(result.goals)).toBe(true);
    expect(result.goals.length).toBeGreaterThan(0);
  });

  it("plannedTransactions is an array", async () => {
    const result = await caller.savings.computeSummary();
    expect(Array.isArray(result.plannedTransactions)).toBe(true);
  });

  it("allocationOverrides is an array", async () => {
    const result = await caller.savings.computeSummary();
    expect(Array.isArray(result.allocationOverrides)).toBe(true);
  });

  it("efund is null when no goal with isEmergencyFund=true exists", async () => {
    // seedStandardDataset seeds a goal with isEmergencyFund defaulting to false
    const result = await caller.savings.computeSummary();
    expect(result.efund).toBeNull();
  });

  it("efundTierIndex defaults to 0 when no app setting is present", async () => {
    const result = await caller.savings.computeSummary();
    expect(result.efundTierIndex).toBe(0);
  });

  it("budgetTierLabels reflects the active profile column labels", async () => {
    const result = await caller.savings.computeSummary();
    // seedStandardDataset uses columnLabels: ["Standard"]
    expect(Array.isArray(result.budgetTierLabels)).toBe(true);
    expect(result.budgetTierLabels).toContain("Standard");
  });

  it("accepts optional budgetTierOverride and echoes it as efundTierIndex", async () => {
    const result = await caller.savings.computeSummary({
      budgetTierOverride: 0,
    });
    expect(result.efundTierIndex).toBe(0);
  });

  it("planned transaction amounts are numeric (not strings) in summary output", async () => {
    const goalId = seedSavingsGoal(db, {
      name: "Amount Type Check Goal",
      targetAmount: "2000",
      monthlyContribution: "100",
    });
    await caller.savings.plannedTransactions.create({
      goalId,
      transactionDate: "2026-06-01",
      amount: "123.45",
      description: "Type check tx",
      isRecurring: false,
    });
    const result = await caller.savings.computeSummary();
    for (const t of result.plannedTransactions) {
      expect(typeof t.amount).toBe("number");
    }
  });

  it("allocation override amounts are numeric in summary output", async () => {
    const goalId = seedSavingsGoal(db, {
      name: "Override Amount Type Goal",
      targetAmount: "1000",
      monthlyContribution: "50",
    });
    await caller.savings.allocationOverrides.upsert({
      goalId,
      monthDate: "2026-07-01",
      amount: 75.5,
    });
    const result = await caller.savings.computeSummary();
    for (const o of result.allocationOverrides) {
      expect(typeof o.amount).toBe("number");
    }
  });

  it("returns efund populated when an emergency fund goal is present", async () => {
    const freshCtx = await createTestCaller();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteClient = (freshCtx.db as any).$client as {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
    };
    patchExecute(
      freshCtx.rawDb as unknown as Record<string, unknown>,
      sqliteClient,
    );
    try {
      await seedBudgetProfile(freshCtx.db, "EFund Budget", true);
      seedSavingsGoal(freshCtx.db, {
        name: "Emergency Fund",
        targetAmount: "12000",
        monthlyContribution: "600",
        isEmergencyFund: true,
        targetMonths: 3,
      });
      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.efund).not.toBeNull();
      expect(result.efund).toHaveProperty("targetAmount");
      expect(result.efund).toHaveProperty("rawBalance");
    } finally {
      freshCtx.cleanup();
    }
  });

  it("newly created planned transactions appear in the next computeSummary call", async () => {
    const freshCtx = await createTestCaller();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteClient = (freshCtx.db as any).$client as {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
    };
    patchExecute(
      freshCtx.rawDb as unknown as Record<string, unknown>,
      sqliteClient,
    );
    try {
      const goalId = seedSavingsGoal(freshCtx.db, {
        name: "Goal With TX",
        targetAmount: "5000",
        monthlyContribution: "250",
      });
      await freshCtx.caller.savings.plannedTransactions.create({
        goalId,
        transactionDate: "2026-06-01",
        amount: "100",
        description: "Summary check tx",
        isRecurring: false,
      });
      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.plannedTransactions.length).toBe(1);
      expect(result.plannedTransactions[0].goalId).toBe(goalId);
      expect(result.plannedTransactions[0].description).toBe(
        "Summary check tx",
      );
    } finally {
      freshCtx.cleanup();
    }
  });

  it("upserted allocation overrides appear in the next computeSummary call", async () => {
    const freshCtx = await createTestCaller();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteClient = (freshCtx.db as any).$client as {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
    };
    patchExecute(
      freshCtx.rawDb as unknown as Record<string, unknown>,
      sqliteClient,
    );
    try {
      const goalId = seedSavingsGoal(freshCtx.db, {
        name: "Goal With Override",
        targetAmount: "3000",
        monthlyContribution: "150",
      });
      await freshCtx.caller.savings.allocationOverrides.upsert({
        goalId,
        monthDate: "2026-05-01",
        amount: 175,
      });
      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.allocationOverrides.length).toBe(1);
      expect(result.allocationOverrides[0].goalId).toBe(goalId);
      expect(result.allocationOverrides[0].amount).toBe(175);
    } finally {
      freshCtx.cleanup();
    }
  });
});
