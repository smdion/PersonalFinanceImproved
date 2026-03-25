/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Additional savings router coverage tests.
 *
 * Targets uncovered lines in src/server/routers/savings.ts:
 *   - computeSummary (db.execute for SQLite, budget API integration)
 *   - listApiBalances (with/without budget API)
 *   - pushContributionsToApi (with/without client)
 *   - listEfundReimbursements (note parsing, skipped lines)
 *   - transfers.create / transfers.delete
 *   - allocationOverrides.upsertMonth / upsertMonthRange / batchUpsert
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import {
  createTestCaller,
  seedSavingsGoal,
  seedStandardDataset,
  seedBudgetProfile,
  seedBudgetItem,
  seedAppSetting,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

const mockGetActiveBudgetApi = vi.fn().mockResolvedValue("none");
const mockGetBudgetAPIClient = vi.fn().mockResolvedValue(null);
const mockCacheGet = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: (...args: unknown[]) => mockGetActiveBudgetApi(...args),
  getBudgetAPIClient: (...args: unknown[]) => mockGetBudgetAPIClient(...args),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  getClientForService: vi.fn().mockResolvedValue(null),
}));

/** Patch rawDb.execute so computeSummary's raw balance query works in SQLite. */
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
    patchExecute(ctx.rawDb as unknown as Record<string, unknown>, ctx.sqlite);
    seedStandardDataset(db);
  });

  afterAll(() => cleanup());

  it("returns summary with goals, efund, and budget tier labels", async () => {
    const result = await caller.savings.computeSummary();
    expect(result).toHaveProperty("savings");
    expect(result).toHaveProperty("goals");
    expect(result).toHaveProperty("budgetTierLabels");
    expect(result).toHaveProperty("efundTierIndex");
    expect(result).toHaveProperty("plannedTransactions");
    expect(result).toHaveProperty("allocationOverrides");
    expect(Array.isArray(result.goals)).toBe(true);
  });

  it("returns summary with budgetTierOverride", async () => {
    const result = await caller.savings.computeSummary({
      budgetTierOverride: 0,
    });
    expect(result.efundTierIndex).toBe(0);
  });

  it("returns summary with no active goals", async () => {
    const freshCtx = await createTestCaller();
    try {
      patchExecute(
        freshCtx.rawDb as unknown as Record<string, unknown>,
        freshCtx.sqlite,
      );
      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.goals).toHaveLength(0);
      expect(result.efund).toBeNull();
    } finally {
      freshCtx.cleanup();
    }
  });

  it("returns summary with an efund goal using budget tiers", async () => {
    const freshCtx = await createTestCaller();
    try {
      patchExecute(
        freshCtx.rawDb as unknown as Record<string, unknown>,
        freshCtx.sqlite,
      );
      const profileId = await seedBudgetProfile(
        freshCtx.db,
        "EFund Budget",
        true,
      );
      seedBudgetItem(freshCtx.db, profileId, {
        category: "Essentials",
        subcategory: "Rent",
        amounts: [2000],
        isEssential: true,
      });
      seedSavingsGoal(freshCtx.db, {
        name: "Emergency Fund",
        targetAmount: "20000",
        monthlyContribution: "500",
        isEmergencyFund: true,
        targetMonths: 6,
        isActive: true,
        priority: 1,
      });
      seedAppSetting(freshCtx.db, "efund_budget_column", "0");

      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.efund).not.toBeNull();
      expect(result.goals.length).toBeGreaterThanOrEqual(1);
    } finally {
      freshCtx.cleanup();
    }
  });

  it("handles API-linked goals when budget API is active", async () => {
    const freshCtx = await createTestCaller();
    try {
      patchExecute(
        freshCtx.rawDb as unknown as Record<string, unknown>,
        freshCtx.sqlite,
      );
      const _goalId = seedSavingsGoal(freshCtx.db, {
        name: "API Goal",
        targetAmount: "5000",
        monthlyContribution: "200",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-123",
        isActive: true,
        priority: 1,
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce({
        data: [
          {
            name: "Savings",
            categories: [
              { id: "cat-123", balance: 3000, budgeted: 200, activity: -100 },
            ],
          },
        ],
      });

      const result = await freshCtx.caller.savings.computeSummary();
      expect(result.goals.length).toBeGreaterThanOrEqual(1);
    } finally {
      freshCtx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockCacheGet.mockResolvedValue(null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listApiBalances
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.listApiBalances", () => {
  it("returns empty balances when no budget API active", async () => {
    const ctx = await createTestCaller();
    try {
      const result = await ctx.caller.savings.listApiBalances();
      expect(result.balances).toEqual([]);
      expect(result.service).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("returns service but empty balances when cache is null", async () => {
    const ctx = await createTestCaller();
    try {
      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce(null);

      const result = await ctx.caller.savings.listApiBalances();
      expect(result.service).toBe("ynab");
      expect(result.balances).toEqual([]);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
    }
  });

  it("returns balances for API-linked goals", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "Linked Goal",
        targetAmount: "5000",
        monthlyContribution: "200",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-abc",
        apiCategoryName: "Test Category",
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce({
        data: [
          {
            name: "Group",
            categories: [
              { id: "cat-abc", balance: 2500, budgeted: 200, activity: -50 },
            ],
          },
        ],
      });

      const result = await ctx.caller.savings.listApiBalances();
      expect(result.balances.length).toBe(1);
      expect(result.balances[0]!.balance).toBe(2500);
      expect(result.balances[0]!.budgeted).toBe(200);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockCacheGet.mockResolvedValue(null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// pushContributionsToApi
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.pushContributionsToApi", () => {
  it("throws PRECONDITION_FAILED when no budget API client", async () => {
    const ctx = await createTestCaller();
    try {
      await expect(ctx.caller.savings.pushContributionsToApi()).rejects.toThrow(
        "No budget API active",
      );
    } finally {
      ctx.cleanup();
    }
  });

  it("pushes contributions for linked goals", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "Push Goal",
        targetAmount: "5000",
        monthlyContribution: "200",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-push-001",
      });

      const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
      mockGetBudgetAPIClient.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("cat-push-001", 200);
    } finally {
      ctx.cleanup();
      mockGetBudgetAPIClient.mockResolvedValue(null);
    }
  });

  it("returns pushed:0 when no linked goals exist", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "Unlinked Goal",
        targetAmount: "5000",
        monthlyContribution: "200",
        isApiSyncEnabled: false,
      });

      mockGetBudgetAPIClient.mockResolvedValueOnce({
        updateCategoryGoalTarget: vi.fn(),
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(0);
    } finally {
      ctx.cleanup();
      mockGetBudgetAPIClient.mockResolvedValue(null);
    }
  });

  it("pushes only the specified goalId when provided", async () => {
    const ctx = await createTestCaller();
    try {
      const g1 = seedSavingsGoal(ctx.db, {
        name: "Goal A",
        monthlyContribution: "100",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-a",
      });
      seedSavingsGoal(ctx.db, {
        name: "Goal B",
        monthlyContribution: "200",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-b",
      });

      const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
      mockGetBudgetAPIClient.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi({
        goalId: g1,
      });
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("cat-a", 100);
    } finally {
      ctx.cleanup();
      mockGetBudgetAPIClient.mockResolvedValue(null);
    }
  });

  it("handles API errors gracefully and continues pushing", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "Error Goal",
        monthlyContribution: "300",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-err",
      });

      const mockUpdateGoal = vi.fn().mockRejectedValue(new Error("API fail"));
      mockGetBudgetAPIClient.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(0);
    } finally {
      ctx.cleanup();
      mockGetBudgetAPIClient.mockResolvedValue(null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listEfundReimbursements
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.listEfundReimbursements", () => {
  it("returns null when no budget API active", async () => {
    const ctx = await createTestCaller();
    try {
      const result = await ctx.caller.savings.listEfundReimbursements();
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("returns null when no efund goal with reimbursement category", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "E-Fund",
        isEmergencyFund: true,
        targetAmount: "15000",
        monthlyContribution: "500",
        // no reimbursementApiCategoryId
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");

      const result = await ctx.caller.savings.listEfundReimbursements();
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
    }
  });

  it("parses note field into reimbursement items", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "E-Fund",
        isEmergencyFund: true,
        targetAmount: "15000",
        monthlyContribution: "500",
        reimbursementApiCategoryId: "reimb-cat-001",
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce({
        data: [
          {
            name: "Reimbursements",
            categories: [
              {
                id: "reimb-cat-001",
                name: "Self-Loan Tracking",
                balance: 500,
                budgeted: 0,
                activity: 0,
                goalTarget: 1000,
                note: "50 - lunch\n$1,200 — hotel\n100.50 - taxi",
              },
            ],
          },
        ],
      });

      const result = await ctx.caller.savings.listEfundReimbursements();
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(3);
      expect(result!.items[0]!.amount).toBe(50);
      expect(result!.items[0]!.description).toBe("lunch");
      expect(result!.items[1]!.amount).toBe(1200);
      expect(result!.items[1]!.description).toBe("hotel");
      expect(result!.items[2]!.amount).toBe(100.5);
      expect(result!.total).toBeCloseTo(1350.5);
      expect(result!.target).toBe(1000);
      expect(result!.categoryName).toBe("Self-Loan Tracking");
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockCacheGet.mockResolvedValue(null);
    }
  });

  it("skips unparseable lines and reports them", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "E-Fund",
        isEmergencyFund: true,
        targetAmount: "15000",
        monthlyContribution: "500",
        reimbursementApiCategoryId: "reimb-cat-002",
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce({
        data: [
          {
            name: "Reimbursements",
            categories: [
              {
                id: "reimb-cat-002",
                name: "Tracking",
                balance: 100,
                budgeted: 0,
                activity: 0,
                note: "50 - valid item\njust a random note\n0 - zero amount",
              },
            ],
          },
        ],
      });

      const result = await ctx.caller.savings.listEfundReimbursements();
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(1);
      expect(result!.skippedLines).toBeDefined();
      expect(result!.skippedLines!.length).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockCacheGet.mockResolvedValue(null);
    }
  });

  it("returns null when reimbursement category not found in cache", async () => {
    const ctx = await createTestCaller();
    try {
      seedSavingsGoal(ctx.db, {
        name: "E-Fund",
        isEmergencyFund: true,
        targetAmount: "15000",
        monthlyContribution: "500",
        reimbursementApiCategoryId: "nonexistent-cat",
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockCacheGet.mockResolvedValueOnce({
        data: [
          {
            name: "Group",
            categories: [
              {
                id: "other-cat",
                name: "Other",
                balance: 0,
                budgeted: 0,
                activity: 0,
              },
            ],
          },
        ],
      });

      const result = await ctx.caller.savings.listEfundReimbursements();
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockCacheGet.mockResolvedValue(null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// transfers
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.transfers", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let goalId1: number;
  let goalId2: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    goalId1 = seedSavingsGoal(db, {
      name: "Fund A",
      targetAmount: "10000",
      monthlyContribution: "500",
    });
    goalId2 = seedSavingsGoal(db, {
      name: "Fund B",
      targetAmount: "5000",
      monthlyContribution: "200",
    });
  });

  afterAll(() => cleanup());

  it("creates a transfer pair between two goals", async () => {
    const result = await caller.savings.transfers.create({
      fromGoalId: goalId1,
      toGoalId: goalId2,
      transactionDate: "2026-05-01",
      amount: 1000,
      description: "Transfer to Fund B",
    });
    expect(result.pairId).toBeDefined();
    expect(result.withdrawal).toBeDefined();
    expect(result.deposit).toBeDefined();
    expect(result.withdrawal.goalId).toBe(goalId1);
    expect(result.deposit.goalId).toBe(goalId2);
    expect(Number(result.withdrawal.amount)).toBe(-1000);
    expect(Number(result.deposit.amount)).toBe(1000);
    expect(result.withdrawal.transferPairId).toBe(result.pairId);
    expect(result.deposit.transferPairId).toBe(result.pairId);
  });

  it("creates a recurring transfer", async () => {
    const result = await caller.savings.transfers.create({
      fromGoalId: goalId1,
      toGoalId: goalId2,
      transactionDate: "2026-06-01",
      amount: 500,
      description: "Monthly transfer",
      isRecurring: true,
      recurrenceMonths: 1,
    });
    expect(result.withdrawal.isRecurring).toBe(true);
    expect(result.deposit.recurrenceMonths).toBe(1);
  });

  it("deletes a transfer pair", async () => {
    const created = await caller.savings.transfers.create({
      fromGoalId: goalId1,
      toGoalId: goalId2,
      transactionDate: "2026-07-01",
      amount: 250,
      description: "To delete",
    });
    const result = await caller.savings.transfers.delete({
      transferPairId: created.pairId,
    });
    expect(result).toEqual({ ok: true });
  });

  it("delete is idempotent for non-existent pair", async () => {
    const result = await caller.savings.transfers.delete({
      transferPairId: "xfer_nonexistent",
    });
    expect(result).toEqual({ ok: true });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// allocationOverrides — upsertMonth, upsertMonthRange, batchUpsert
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.allocationOverrides advanced", () => {
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
      name: "Override Goal A",
      targetAmount: "10000",
      monthlyContribution: "500",
    });
    goalId2 = seedSavingsGoal(db, {
      name: "Override Goal B",
      targetAmount: "5000",
      monthlyContribution: "200",
    });
  });

  afterAll(() => cleanup());

  describe("upsertMonth", () => {
    it("inserts overrides for all goals in a month", async () => {
      const result = await caller.savings.allocationOverrides.upsertMonth({
        monthDate: "2027-03-01",
        allocations: [
          { goalId, amount: 600 },
          { goalId: goalId2, amount: 100 },
        ],
      });
      expect(result).toEqual({ ok: true });
    });

    it("replaces existing overrides for the month", async () => {
      const result = await caller.savings.allocationOverrides.upsertMonth({
        monthDate: "2027-03-01",
        allocations: [
          { goalId, amount: 700 },
          { goalId: goalId2, amount: 0 },
        ],
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("upsertMonthRange", () => {
    it("fills overrides across a date range", async () => {
      const result = await caller.savings.allocationOverrides.upsertMonthRange({
        startMonth: "2027-04-01",
        endMonth: "2027-06-01",
        monthDates: ["2027-04-01", "2027-05-01", "2027-06-01"],
        allocations: [
          { goalId, amount: 400 },
          { goalId: goalId2, amount: 300 },
        ],
      });
      expect(result).toEqual({ ok: true });
    });

    it("handles null endMonth (open-ended range)", async () => {
      const result = await caller.savings.allocationOverrides.upsertMonthRange({
        startMonth: "2027-07-01",
        endMonth: null,
        monthDates: ["2027-07-01", "2027-08-01"],
        allocations: [{ goalId, amount: 500 }],
      });
      expect(result).toEqual({ ok: true });
    });

    it("does nothing when monthDates are outside the range", async () => {
      const result = await caller.savings.allocationOverrides.upsertMonthRange({
        startMonth: "2028-01-01",
        endMonth: "2028-03-01",
        monthDates: ["2027-06-01"], // all before startMonth
        allocations: [{ goalId, amount: 500 }],
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("batchUpsert", () => {
    it("batch upserts overrides for a single goal", async () => {
      const result = await caller.savings.allocationOverrides.batchUpsert({
        goalId,
        overrides: [
          { monthDate: "2027-09-01", amount: 800 },
          { monthDate: "2027-10-01", amount: 900 },
        ],
      });
      expect(result).toEqual({ ok: true });
    });

    it("updates existing entries on re-call", async () => {
      // First call
      await caller.savings.allocationOverrides.batchUpsert({
        goalId,
        overrides: [{ monthDate: "2027-11-01", amount: 100 }],
      });
      // Second call — should update
      const result = await caller.savings.allocationOverrides.batchUpsert({
        goalId,
        overrides: [{ monthDate: "2027-11-01", amount: 200 }],
      });
      expect(result).toEqual({ ok: true });
    });

    it("handles empty overrides array", async () => {
      const result = await caller.savings.allocationOverrides.batchUpsert({
        goalId,
        overrides: [],
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
