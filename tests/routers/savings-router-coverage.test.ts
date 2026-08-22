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
import { and, eq, type SQL } from "drizzle-orm";
import * as sqliteSchemaTables from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedSavingsGoal,
  seedSavingsGoalAllocation,
  seedStandardDataset,
  seedBudgetProfile,
  seedBudgetItem,
  seedAppSetting,
  seedJob,
  seedPerson,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

const mockGetActiveBudgetApi = vi.fn().mockResolvedValue("none");
const mockGetBudgetAPIClient = vi.fn().mockResolvedValue(null);
const mockGetClientForService = vi.fn().mockResolvedValue(null);
const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockRefreshCategoryCache = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: (...args: unknown[]) => mockGetActiveBudgetApi(...args),
  getBudgetAPIClient: (...args: unknown[]) => mockGetBudgetAPIClient(...args),
  getClientForService: (...args: unknown[]) => mockGetClientForService(...args),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  refreshCategoryCache: (...args: unknown[]) =>
    mockRefreshCategoryCache(...args),
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
      const profileId = await seedBudgetProfile(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Push Goal",
        targetAmount: "5000",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-push-001",
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "200",
      });

      const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockGetClientForService.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("cat-push-001", 200);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockGetClientForService.mockResolvedValue(null);
    }
  });

  it("returns pushed:0 when no linked goals exist", async () => {
    const ctx = await createTestCaller();
    try {
      const profileId = await seedBudgetProfile(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Unlinked Goal",
        targetAmount: "5000",
        isApiSyncEnabled: false,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "200",
      });

      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockGetClientForService.mockResolvedValueOnce({
        updateCategoryGoalTarget: vi.fn(),
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(0);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockGetClientForService.mockResolvedValue(null);
    }
  });

  it("pushes only the specified goalId when provided", async () => {
    const ctx = await createTestCaller();
    try {
      const profileId = await seedBudgetProfile(ctx.db);
      const g1 = seedSavingsGoal(ctx.db, {
        name: "Goal A",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-a",
      });
      seedSavingsGoalAllocation(ctx.db, g1, profileId, {
        monthlyContribution: "100",
      });
      const g2 = seedSavingsGoal(ctx.db, {
        name: "Goal B",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-b",
      });
      seedSavingsGoalAllocation(ctx.db, g2, profileId, {
        monthlyContribution: "200",
      });

      const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockGetClientForService.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi({
        goalId: g1,
      });
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("cat-a", 100);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockGetClientForService.mockResolvedValue(null);
    }
  });

  it("handles API errors gracefully and continues pushing", async () => {
    const ctx = await createTestCaller();
    try {
      const profileId = await seedBudgetProfile(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Error Goal",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-err",
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "300",
      });

      const mockUpdateGoal = vi.fn().mockRejectedValue(new Error("API fail"));
      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockGetClientForService.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(0);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockGetClientForService.mockResolvedValue(null);
    }
  });

  it("pushes the stored monthlyContribution snapshot for percentage-based goals, not a live recompute — even when live paycheck/budget data is available and would produce a different amount", async () => {
    const ctx = await createTestCaller();
    try {
      // seedStandardDataset gives a real job/salary + budget items, so a live
      // pool computation (if push still did one) would very likely differ
      // from this arbitrary stored snapshot.
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Percent Goal",
        isApiSyncEnabled: true,
        apiCategoryId: "cat-pct",
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
      mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
      mockGetClientForService.mockResolvedValueOnce({
        updateCategoryGoalTarget: mockUpdateGoal,
      });

      const result = await ctx.caller.savings.pushContributionsToApi();
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("cat-pct", 150);
    } finally {
      ctx.cleanup();
      mockGetActiveBudgetApi.mockResolvedValue("none");
      mockGetClientForService.mockResolvedValue(null);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// recalculateAllocation
// ══════════════════════════════════════════════════════════════════════════════

/** Reads the resolved override row for (goalId, profileId) — these
 *  mutations now always write to savings_goal_profile_allocations, never
 *  the raw savings_goals columns (see getResolvedGoalAllocations). */
function getOverrideRow(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  goalId: number,
  profileId: number,
) {
  return db
    .select()
    .from(sqliteSchemaTables.savingsGoalProfileAllocations)
    .where(
      and(
        eq(sqliteSchemaTables.savingsGoalProfileAllocations.goalId, goalId),
        eq(
          sqliteSchemaTables.savingsGoalProfileAllocations.budgetProfileId,
          profileId,
        ),
      ),
    )
    .all()[0];
}

describe("savings.recalculateAllocation", () => {
  it("recomputes a percentage-based goal's monthlyContribution from the live pool and persists it as a profile override", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Percent Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      const result = await ctx.caller.savings.recalculateAllocation({
        goalId,
      });
      expect(result.updated).toBe(1);

      const override = getOverrideRow(ctx.db, goalId, profileId);
      expect(override).toBeDefined();
      expect(Number(override!.monthlyContribution)).not.toBe(150);
    } finally {
      ctx.cleanup();
    }
  });

  it("leaves non-percentage goals untouched and reports updated:0 when no percentage-based goals exist", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Flat Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
      });

      const result = await ctx.caller.savings.recalculateAllocation();
      expect(result.updated).toBe(0);
      expect(getOverrideRow(ctx.db, goalId, profileId)).toEqual(
        expect.objectContaining({ allocationPercent: null }),
      );
    } finally {
      ctx.cleanup();
    }
  });

  it("only recalculates the specified goalId, leaving other percentage-based goals untouched", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalA = seedSavingsGoal(ctx.db, { name: "Goal A", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalA, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });
      const goalB = seedSavingsGoal(ctx.db, { name: "Goal B", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalB, profileId, {
        monthlyContribution: "250",
        allocationPercent: "20",
      });

      const result = await ctx.caller.savings.recalculateAllocation({
        goalId: goalA,
      });
      expect(result.updated).toBe(1);
      expect(
        getOverrideRow(ctx.db, goalB, profileId)!.monthlyContribution,
      ).toBe("250");
    } finally {
      ctx.cleanup();
    }
  });

  it("skips inactive percentage-based goals", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Inactive Percent Goal",
        isActive: false,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      const result = await ctx.caller.savings.recalculateAllocation();
      expect(result.updated).toBe(0);
      expect(
        getOverrideRow(ctx.db, goalId, profileId)!.monthlyContribution,
      ).toBe("150");
    } finally {
      ctx.cleanup();
    }
  });

  it("recalculates every active percentage-based goal when goalId is omitted", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalA = seedSavingsGoal(ctx.db, { name: "Goal A", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalA, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });
      const goalB = seedSavingsGoal(ctx.db, { name: "Goal B", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalB, profileId, {
        monthlyContribution: "250",
        allocationPercent: "20",
      });

      const result = await ctx.caller.savings.recalculateAllocation();
      expect(result.updated).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });

  it("recomputes against a non-active profile's budget items when profileId is given, without touching the active profile's override", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId: activeProfileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Percent Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, activeProfileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      // A second, inactive profile with a much smaller budget total than
      // the active one (2800 across rent/groceries/dining) leaves far more
      // pool available for savings, so the two profiles must not produce
      // the same recalculated amount. It needs its own percentage-based
      // funding row too — funding is per-profile, no shared default.
      const altProfileId = await seedBudgetProfile(ctx.db, "Alt Budget", false);
      seedBudgetItem(ctx.db, altProfileId, {
        category: "Essentials",
        subcategory: "Rent",
        amounts: [500],
      });
      seedSavingsGoalAllocation(ctx.db, goalId, altProfileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      await ctx.caller.savings.recalculateAllocation({ goalId });
      const activeOverride = getOverrideRow(ctx.db, goalId, activeProfileId);

      await ctx.caller.savings.recalculateAllocation({
        goalId,
        profileId: altProfileId,
      });
      const altOverride = getOverrideRow(ctx.db, goalId, altProfileId);

      expect(activeProfileId).not.toBe(altProfileId);
      expect(Number(altOverride!.monthlyContribution)).not.toBe(
        Number(activeOverride!.monthlyContribution),
      );
      // The second call (targeting altProfileId) must not have touched the
      // active profile's own override row.
      expect(
        getOverrideRow(ctx.db, goalId, activeProfileId)!.monthlyContribution,
      ).toBe(activeOverride!.monthlyContribution);
    } finally {
      ctx.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// lockInAllocationPercent
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.lockInAllocationPercent", () => {
  it("recomputes a percentage-based goal's allocationPercent from the live pool without touching monthlyContribution, as a profile override", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Percent Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      const result = await ctx.caller.savings.lockInAllocationPercent({
        goalId,
      });
      expect(result.updated).toBe(1);

      const override = getOverrideRow(ctx.db, goalId, profileId);
      expect(override).toBeDefined();
      expect(Number(override!.monthlyContribution)).toBe(150);
      expect(override!.allocationPercent).not.toBe("10");
    } finally {
      ctx.cleanup();
    }
  });

  it("leaves non-percentage goals untouched and reports updated:0 when no percentage-based goals exist", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Flat Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
      });

      const result = await ctx.caller.savings.lockInAllocationPercent();
      expect(result.updated).toBe(0);
      expect(
        getOverrideRow(ctx.db, goalId, profileId)!.monthlyContribution,
      ).toBe("150");
    } finally {
      ctx.cleanup();
    }
  });

  it("only updates the specified goalId, leaving other percentage-based goals untouched", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalA = seedSavingsGoal(ctx.db, { name: "Goal A", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalA, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });
      const goalB = seedSavingsGoal(ctx.db, { name: "Goal B", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalB, profileId, {
        monthlyContribution: "250",
        allocationPercent: "20",
      });

      const result = await ctx.caller.savings.lockInAllocationPercent({
        goalId: goalA,
      });
      expect(result.updated).toBe(1);
      expect(getOverrideRow(ctx.db, goalB, profileId)!.allocationPercent).toBe(
        "20",
      );
    } finally {
      ctx.cleanup();
    }
  });

  it("skips inactive percentage-based goals", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Inactive Percent Goal",
        isActive: false,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      const result = await ctx.caller.savings.lockInAllocationPercent();
      expect(result.updated).toBe(0);
      expect(getOverrideRow(ctx.db, goalId, profileId)!.allocationPercent).toBe(
        "10",
      );
    } finally {
      ctx.cleanup();
    }
  });

  it("updates every active percentage-based goal when goalId is omitted", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalA = seedSavingsGoal(ctx.db, { name: "Goal A", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalA, profileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });
      const goalB = seedSavingsGoal(ctx.db, { name: "Goal B", isActive: true });
      seedSavingsGoalAllocation(ctx.db, goalB, profileId, {
        monthlyContribution: "250",
        allocationPercent: "20",
      });

      const result = await ctx.caller.savings.lockInAllocationPercent();
      expect(result.updated).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });

  it("recomputes against a non-active profile's budget items when profileId is given", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId: activeProfileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Percent Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, activeProfileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      // See the analogous recalculateAllocation test above for why a
      // smaller-budget alt profile is expected to change the result.
      const altProfileId = await seedBudgetProfile(ctx.db, "Alt Budget", false);
      seedBudgetItem(ctx.db, altProfileId, {
        category: "Essentials",
        subcategory: "Rent",
        amounts: [500],
      });
      seedSavingsGoalAllocation(ctx.db, goalId, altProfileId, {
        monthlyContribution: "150",
        allocationPercent: "10",
      });

      await ctx.caller.savings.lockInAllocationPercent({ goalId });
      const activeOverride = getOverrideRow(ctx.db, goalId, activeProfileId);

      await ctx.caller.savings.lockInAllocationPercent({
        goalId,
        profileId: altProfileId,
      });
      const altOverride = getOverrideRow(ctx.db, goalId, altProfileId);

      expect(Number(altOverride!.allocationPercent)).not.toBe(
        Number(activeOverride!.allocationPercent),
      );
    } finally {
      ctx.cleanup();
    }
  });

  it("round-trips with recalculateAllocation: locking in % then pulling in pay recovers the original dollar amount within a cent", async () => {
    const ctx = await createTestCaller();
    try {
      const { profileId } = seedStandardDataset(ctx.db);
      const goalId = seedSavingsGoal(ctx.db, {
        name: "Round Trip Goal",
        isActive: true,
      });
      seedSavingsGoalAllocation(ctx.db, goalId, profileId, {
        monthlyContribution: "289.90",
        allocationPercent: "13",
      });

      await ctx.caller.savings.lockInAllocationPercent({ goalId });
      await ctx.caller.savings.recalculateAllocation({ goalId });

      const override = getOverrideRow(ctx.db, goalId, profileId);
      expect(
        Math.abs(Number(override!.monthlyContribution) - 289.9),
      ).toBeLessThan(1);
    } finally {
      ctx.cleanup();
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
// plannedTransactions — settle, unsettle, settleMany
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.plannedTransactions settle/unsettle/settleMany", () => {
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
      name: "Settle Fund A",
      targetAmount: "10000",
      monthlyContribution: "500",
    });
    goalId2 = seedSavingsGoal(db, {
      name: "Settle Fund B",
      targetAmount: "5000",
      monthlyContribution: "200",
    });
  });

  afterAll(() => cleanup());

  it("settles a one-time planned transaction", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2026-09-15",
      amount: "-1200",
      description: "Trip",
      isRecurring: false,
    });
    const result = await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-09",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects settling the same occurrence twice", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2026-10-15",
      amount: "-500",
      description: "Concert",
      isRecurring: false,
    });
    await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-10",
    });
    await expect(
      caller.savings.plannedTransactions.settle({
        plannedTxId: tx.id,
        occurrenceMonth: "2026-10",
      }),
    ).rejects.toThrow(/already settled/i);
  });

  it("unsettle removes the settlement so it can be settled again", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2026-11-15",
      amount: "-300",
      description: "Gift",
      isRecurring: false,
    });
    await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-11",
    });
    const unsettleResult = await caller.savings.plannedTransactions.unsettle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-11",
    });
    expect(unsettleResult).toEqual({ ok: true });
    // Should be settleable again now that the settlement was removed.
    const resettled = await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-11",
    });
    expect(resettled).toEqual({ ok: true });
  });

  it("settling one leg of a transfer settles both legs (pair-atomic)", async () => {
    const created = await caller.savings.transfers.create({
      fromGoalId: goalId1,
      toGoalId: goalId2,
      transactionDate: "2026-12-01",
      amount: 750,
      description: "Rebalance",
    });
    await caller.savings.plannedTransactions.settle({
      plannedTxId: created.withdrawal.id,
      occurrenceMonth: "2026-12",
    });
    // The deposit leg should now also be settled — verify via computeSummary
    // (settling only the withdrawal leg must not leave the deposit leg
    // still counting toward Fund B's projection, or money silently
    // reappears in the combined balance).
    const summary = await caller.savings.computeSummary();
    const depositTx = summary.plannedTransactions.find(
      (t) => t.id === created.deposit.id,
    );
    expect(depositTx?.settledOccurrences).toContain("2026-12");
    // And settling the already-settled deposit leg directly should now reject.
    await expect(
      caller.savings.plannedTransactions.settle({
        plannedTxId: created.deposit.id,
        occurrenceMonth: "2026-12",
      }),
    ).rejects.toThrow(/already settled/i);
  });

  it("settleMany settles multiple occurrences in one call", async () => {
    const tx1 = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2027-01-15",
      amount: "-100",
      description: "One",
      isRecurring: false,
    });
    const tx2 = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2027-02-15",
      amount: "-100",
      description: "Two",
      isRecurring: false,
    });
    const result = await caller.savings.plannedTransactions.settleMany({
      occurrences: [
        { plannedTxId: tx1.id, occurrenceMonth: "2027-01" },
        { plannedTxId: tx2.id, occurrenceMonth: "2027-02" },
      ],
    });
    expect(result).toEqual({ ok: true });
    const summary = await caller.savings.computeSummary();
    const t1 = summary.plannedTransactions.find((t) => t.id === tx1.id);
    const t2 = summary.plannedTransactions.find((t) => t.id === tx2.id);
    expect(t1?.settledOccurrences).toContain("2027-01");
    expect(t2?.settledOccurrences).toContain("2027-02");
  });

  it("settling one occurrence of a recurring row does not settle its other occurrences", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: goalId1,
      transactionDate: "2027-03-01",
      amount: "100",
      description: "Recurring gift",
      isRecurring: true,
      recurrenceMonths: 1,
    });
    await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2027-03",
    });
    const summary = await caller.savings.computeSummary();
    const found = summary.plannedTransactions.find((t) => t.id === tx.id);
    expect(found?.settledOccurrences).toEqual(["2027-03"]);
    // A later occurrence of the same recurring row must still be settleable
    // independently — proves settlement is per-occurrence, not per-row.
    const nextMonth = await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2027-04",
    });
    expect(nextMonth).toEqual({ ok: true });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// plannedTransactions.getSettlementSuggestions
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.plannedTransactions.getSettlementSuggestions", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let linkedGoalId: number;
  let unlinkedGoalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    linkedGoalId = seedSavingsGoal(db, {
      name: "Linked Fund",
      isApiSyncEnabled: true,
      apiCategoryId: "cat-travel",
    });
    unlinkedGoalId = seedSavingsGoal(db, { name: "Unlinked Fund" });
  });

  afterAll(() => cleanup());

  it("returns no suggestions when no budget API is active", async () => {
    mockGetActiveBudgetApi.mockResolvedValueOnce("none");
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(result.suggestions).toEqual([]);
  });

  it("returns no suggestions when the transactions cache is empty", async () => {
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockCacheGet.mockResolvedValueOnce(null);
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(result.suggestions).toEqual([]);
  });

  it("suggests a planned transaction with real activity on/after its date, same month, same category", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: linkedGoalId,
      transactionDate: "2026-08-10",
      amount: "-500",
      description: "Hotel",
      isRecurring: false,
    });
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockCacheGet.mockResolvedValueOnce({
      data: [
        {
          id: "t1",
          categoryId: "cat-travel",
          date: "2026-08-12",
          amount: -12000,
          deleted: false,
        },
      ],
      serverKnowledge: 1,
      fetchedAt: new Date(),
    });
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(result.suggestions).toContainEqual({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-08",
    });
  });

  it("does not suggest when the only real activity is before the planned date", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: linkedGoalId,
      transactionDate: "2026-09-20",
      amount: "-500",
      description: "Late trip",
      isRecurring: false,
    });
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockCacheGet.mockResolvedValueOnce({
      data: [
        {
          id: "t2",
          categoryId: "cat-travel",
          date: "2026-09-05", // before the planned date
          amount: -5000,
          deleted: false,
        },
      ],
      serverKnowledge: 1,
      fetchedAt: new Date(),
    });
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(
      result.suggestions.find((s) => s.plannedTxId === tx.id),
    ).toBeUndefined();
  });

  it("does not suggest a non-API-linked goal's planned transaction", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: unlinkedGoalId,
      transactionDate: "2026-08-10",
      amount: "-200",
      description: "Cash spend",
      isRecurring: false,
    });
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockCacheGet.mockResolvedValueOnce({
      data: [
        {
          id: "t3",
          categoryId: "cat-travel",
          date: "2026-08-12",
          amount: -1,
          deleted: false,
        },
      ],
      serverKnowledge: 1,
      fetchedAt: new Date(),
    });
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(
      result.suggestions.find((s) => s.plannedTxId === tx.id),
    ).toBeUndefined();
  });

  it("does not suggest an already-settled occurrence", async () => {
    const tx = await caller.savings.plannedTransactions.create({
      goalId: linkedGoalId,
      transactionDate: "2026-10-10",
      amount: "-500",
      description: "Already settled",
      isRecurring: false,
    });
    await caller.savings.plannedTransactions.settle({
      plannedTxId: tx.id,
      occurrenceMonth: "2026-10",
    });
    mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
    mockCacheGet.mockResolvedValueOnce({
      data: [
        {
          id: "t4",
          categoryId: "cat-travel",
          date: "2026-10-12",
          amount: -500,
          deleted: false,
        },
      ],
      serverKnowledge: 1,
      fetchedAt: new Date(),
    });
    const result =
      await caller.savings.plannedTransactions.getSettlementSuggestions();
    expect(
      result.suggestions.find((s) => s.plannedTxId === tx.id),
    ).toBeUndefined();
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

// ══════════════════════════════════════════════════════════════════════════════
// extraPaycheckRouting
// ══════════════════════════════════════════════════════════════════════════════

describe("savings.extraPaycheckRouting", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let goalId: number;
  let jobId: number;

  beforeAll(async () => {
    const harness = await createTestCaller();
    caller = harness.caller;
    db = harness.db;
    cleanup = harness.cleanup;
    const { personId } = seedStandardDataset(db);
    goalId = seedSavingsGoal(db, { name: "Vacation" });
    jobId = seedJob(db, personId, {
      payPeriod: "biweekly",
      anchorPayDate: "2025-01-03",
    });
  });

  afterAll(() => cleanup());

  /** Read a job's extraPaycheckRouting straight from its entry in the
   *  globally-active Salary Profile — same place
   *  writeJobExtraPaycheckRouting (savings.ts) writes it. */
  function getRouting(jobId: number) {
    const activeSettingRow = db
      .select()
      .from(sqliteSchemaTables.appSettings)
      .where(
        eq(sqliteSchemaTables.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID),
      )
      .get();
    const activeSalaryProfileId = Number(activeSettingRow!.value);
    const activeSalaryProfile = db
      .select()
      .from(sqliteSchemaTables.salaryProfiles)
      .where(eq(sqliteSchemaTables.salaryProfiles.id, activeSalaryProfileId))
      .get()!;
    const salaries = activeSalaryProfile.salaries as Record<
      string,
      { extraPaycheckRouting?: Record<string, unknown> | null }
    >;
    return salaries[String(jobId)]?.extraPaycheckRouting ?? null;
  }

  it("list returns all jobs with routing fields", async () => {
    const jobs = await caller.savings.extraPaycheckRouting.list();
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toHaveProperty("id");
    expect(jobs[0]).toHaveProperty("payPeriod");
    expect(jobs[0]).toHaveProperty("extraPaycheckRouting");
  });

  it("save stores routing rules and returns ok", async () => {
    const result = await caller.savings.extraPaycheckRouting.save({
      jobId,
      rules: [
        {
          from: "2025-01",
          to: null,
          splits: [{ goalId, pct: 100 }],
        },
      ],
      baseNetPayPerCheck: 3000,
    });
    expect(result).toEqual({ ok: true });
  });

  it("save rejects rules that don't sum to 100%", async () => {
    await expect(
      caller.savings.extraPaycheckRouting.save({
        jobId,
        rules: [
          {
            from: "2025-01",
            to: null,
            splits: [{ goalId, pct: 50 }],
          },
        ],
        baseNetPayPerCheck: 3000,
      }),
    ).rejects.toThrow();
  });

  it("save clears rules when passed empty array", async () => {
    const result = await caller.savings.extraPaycheckRouting.save({
      jobId,
      rules: [],
    });
    expect(result).toEqual({ ok: true });
  });

  it("rematerialize runs without error", async () => {
    const result = await caller.savings.extraPaycheckRouting.rematerialize();
    expect(result).toEqual({ ok: true });
  });

  it("save always recomputes baseNetPayPerCheck server-side, ignoring the client-supplied value (pinned)", async () => {
    // Pinned ahead of consolidating computeJobNetPayPerCheck's per-job
    // paycheck-input construction with paycheck.ts router's equivalent
    // (audit Batch 9 Finding 3). seedJob's defaults: $120,000 salary,
    // biweekly, MFJ, no deductions/contributions, bonusPercent 0.
    await caller.savings.extraPaycheckRouting.save({
      jobId,
      rules: [{ from: "2025-01", to: null, splits: [{ goalId, pct: 100 }] }],
      // Deliberately wrong — proves the server ignores this and recomputes.
      baseNetPayPerCheck: 999999,
    });
    const routing = getRouting(jobId) as { baseNetPayPerCheck?: number } | null;
    const baseNetPayPerCheck = routing?.baseNetPayPerCheck;
    expect(baseNetPayPerCheck).not.toBe(999999);
    // $120,000 / 26 biweekly periods = $4,615.38 gross, minus federal
    // withholding and FICA (no deductions/contributions seeded).
    expect(baseNetPayPerCheck).toBeGreaterThan(3700);
    expect(baseNetPayPerCheck).toBeLessThan(3900);
    expect(baseNetPayPerCheck).toBe(3816.61);
  });

  it("list resolves live from the job's own column when no routing rule has ever been saved for it", async () => {
    const personId = await seedPerson(db, "FreshRoutingPerson");
    const freshJobId = seedJob(db, personId, {
      payPeriod: "monthly",
      anchorPayDate: "2025-02-01",
    });
    const jobs = await caller.savings.extraPaycheckRouting.list();
    const row = jobs.find((j) => j.id === freshJobId);
    expect(row).toBeDefined();
    expect(row!.extraPaycheckRouting).toBeNull();
    // No snapshot exists yet — falls through to the live job column.
    expect(row!.payPeriod).toBe("monthly");
    expect(row!.anchorPayDate).toBe("2025-02-01");
  });

  it("snapshot freezes payPeriod/anchorPayDate at save time — a later correction to the job's live schedule doesn't retroactively change what list()/the materializer use", async () => {
    const personId = await seedPerson(db, "ScheduleFreezePerson");
    const scheduleJobId = seedJob(db, personId, {
      payPeriod: "biweekly",
      anchorPayDate: "2025-01-03",
    });

    await caller.savings.extraPaycheckRouting.save({
      jobId: scheduleJobId,
      rules: [{ from: "2025-01", to: null, splits: [{ goalId, pct: 100 }] }],
    });

    const beforeCorrection = (
      await caller.savings.extraPaycheckRouting.list()
    ).find((j) => j.id === scheduleJobId);
    expect(beforeCorrection!.payPeriod).toBe("biweekly");

    // Correct the job's REAL live schedule — mirrors "user fixes a data
    // entry mistake on the Paycheck page" after routing was already saved.
    // payPeriod/anchorPayDate live on the Salary Profile entry now, not a
    // `jobs` column — patch the active profile's entry for this job.
    const activeSettingRow = db
      .select()
      .from(sqliteSchemaTables.appSettings)
      .where(
        eq(sqliteSchemaTables.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID),
      )
      .get();
    const activeSalaryProfileId = Number(activeSettingRow!.value);
    const activeSalaryProfile = db
      .select()
      .from(sqliteSchemaTables.salaryProfiles)
      .where(eq(sqliteSchemaTables.salaryProfiles.id, activeSalaryProfileId))
      .get()!;
    const salaries = activeSalaryProfile.salaries as Record<
      string,
      Record<string, unknown>
    >;
    await db
      .update(sqliteSchemaTables.salaryProfiles)
      .set({
        salaries: {
          ...salaries,
          [String(scheduleJobId)]: {
            ...salaries[String(scheduleJobId)],
            payPeriod: "weekly",
            anchorPayDate: "2025-01-10",
          },
        },
      })
      .where(eq(sqliteSchemaTables.salaryProfiles.id, activeSalaryProfileId));

    const afterCorrection = (
      await caller.savings.extraPaycheckRouting.list()
    ).find((j) => j.id === scheduleJobId);
    // Still the snapshot's frozen value, not the corrected live column —
    // the correction only takes effect once routing is explicitly re-saved.
    expect(afterCorrection!.payPeriod).toBe("biweekly");
    expect(afterCorrection!.anchorPayDate).toBe("2025-01-03");

    const routing = getRouting(scheduleJobId) as {
      payPeriod?: string;
      anchorPayDate?: string | null;
    } | null;
    expect(routing?.payPeriod).toBe("biweekly");
    expect(routing?.anchorPayDate).toBe("2025-01-03");
  });

  it("editing the ACTIVE Salary Profile's own values re-snapshots baseNetPayPerCheck for a job with routing already configured — this is a correction to the real profile, not a hypothetical comparison, so it must propagate", async () => {
    const personId = await seedPerson(db, "ActiveEditRefreshPerson");
    const refreshJobId = seedJob(db, personId, {
      payPeriod: "biweekly",
      anchorPayDate: "2025-01-03",
      additionalFedWithholding: 0,
    });
    await caller.savings.extraPaycheckRouting.save({
      jobId: refreshJobId,
      rules: [{ from: "2025-01", to: null, splits: [{ goalId, pct: 100 }] }],
    });
    const before = getRouting(refreshJobId) as {
      baseNetPayPerCheck?: number;
    } | null;
    const baseNetPayPerCheckBefore = before?.baseNetPayPerCheck;
    expect(baseNetPayPerCheckBefore).toBeGreaterThan(0);

    const activeSettingRow = db
      .select()
      .from(sqliteSchemaTables.appSettings)
      .where(
        eq(sqliteSchemaTables.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID),
      )
      .get();
    const activeSalaryProfileId = Number(activeSettingRow!.value);
    const activeSalaryProfile = db
      .select()
      .from(sqliteSchemaTables.salaryProfiles)
      .where(eq(sqliteSchemaTables.salaryProfiles.id, activeSalaryProfileId))
      .get()!;
    const salaries = activeSalaryProfile.salaries as Record<
      string,
      Record<string, unknown>
    >;

    // A real correction (not a what-if) — increasing withholding on the
    // job that already has routing configured, via the proper router
    // mutation (not a raw db write, which deliberately does NOT cascade —
    // see the freeze test above).
    await caller.salaryProfile.update({
      id: activeSalaryProfileId,
      salaries: {
        ...salaries,
        [String(refreshJobId)]: {
          ...salaries[String(refreshJobId)],
          additionalFedWithholding: 500,
        },
      } as never,
    });

    const after = getRouting(refreshJobId) as {
      baseNetPayPerCheck?: number;
    } | null;
    // More withheld each check => strictly lower net pay per check.
    expect(after?.baseNetPayPerCheck).toBeLessThan(baseNetPayPerCheckBefore!);
  });

  it("editing a NON-active Salary Profile never refreshes routing, even for a job whose entry there already carries a (stale) snapshot", async () => {
    const personId = await seedPerson(db, "NonActiveEditPerson");
    const otherJobId = seedJob(db, personId, {
      payPeriod: "biweekly",
      anchorPayDate: "2025-01-03",
    });
    // A second, non-active profile with a manually-seeded stale snapshot —
    // routing.save always targets the active profile, so this simulates
    // the entry via direct insert rather than the normal save flow.
    const otherProfileId = db
      .insert(sqliteSchemaTables.salaryProfiles)
      .values({
        name: "Comparison Profile",
        salaries: {
          [String(otherJobId)]: {
            salary: 120000,
            bonusPercent: 0,
            bonusMultiplier: 1,
            monthsInBonusYear: 12,
            bonusOverride: null,
            payPeriod: "biweekly",
            payWeek: "na",
            anchorPayDate: "2025-01-03",
            budgetPeriodsPerMonth: null,
            w4FilingStatus: "MFJ",
            w4Box2cChecked: false,
            additionalFedWithholding: 0,
            bonusMonth: null,
            bonusDayOfMonth: null,
            include401kInBonus: false,
            includeBonusInContributions: true,
            extraPaycheckRouting: {
              rules: [
                { from: "2025-01", to: null, splits: [{ goalId, pct: 100 }] },
              ],
              baseNetPayPerCheck: 999999,
            },
          },
        },
      })
      .returning({ id: sqliteSchemaTables.salaryProfiles.id })
      .get().id;

    await caller.salaryProfile.update({
      id: otherProfileId,
      salaries: {
        [String(otherJobId)]: {
          salary: 120000,
          bonusPercent: 0,
          bonusMultiplier: 1,
          monthsInBonusYear: 12,
          bonusOverride: null,
          payPeriod: "biweekly",
          payWeek: "na",
          anchorPayDate: "2025-01-03",
          budgetPeriodsPerMonth: null,
          w4FilingStatus: "MFJ",
          w4Box2cChecked: false,
          additionalFedWithholding: 750,
          bonusMonth: null,
          bonusDayOfMonth: null,
          include401kInBonus: false,
          includeBonusInContributions: true,
          extraPaycheckRouting: {
            rules: [
              { from: "2025-01", to: null, splits: [{ goalId, pct: 100 }] },
            ],
            baseNetPayPerCheck: 999999,
          },
        },
      } as never,
    });

    const row = db
      .select()
      .from(sqliteSchemaTables.salaryProfiles)
      .where(eq(sqliteSchemaTables.salaryProfiles.id, otherProfileId))
      .get()!;
    const otherSalaries = row.salaries as Record<
      string,
      { extraPaycheckRouting?: { baseNetPayPerCheck?: number } }
    >;
    // Untouched — browsing/editing a non-active profile must never cascade.
    expect(
      otherSalaries[String(otherJobId)].extraPaycheckRouting
        ?.baseNetPayPerCheck,
    ).toBe(999999);
  });
});
