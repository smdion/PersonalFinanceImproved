/**
 * Sync names router integration tests.
 *
 * Tests budget item and savings goal rename operations using
 * an isolated SQLite database. Procedures that rely on cached API data
 * (syncAllNames) are tested with the "no cache" path.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Mock budget-api (used by syncAllNames for category cache lookup)
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));
import { createTestCaller, seedBudgetProfile } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

describe("sync names router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let budgetItemId: number;
  let goalId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed a budget profile + item with apiCategoryName
    const profileId = await seedBudgetProfile(db);
    const item = db
      .insert((await import("@/lib/db/schema-sqlite")).budgetItems)
      .values({
        profileId,
        category: "Groceries",
        subcategory: "Weekly Food",
        amounts: [100],
        isLinked: false,
        apiCategoryId: "cat-123",
        apiCategoryName: "Food & Drink",
      })
      .returning()
      .get();
    budgetItemId = item.id;

    // Seed a savings goal with apiCategoryName
    const goal = db
      .insert((await import("@/lib/db/schema-sqlite")).savingsGoals)
      .values({
        name: "Emergency Fund",
        targetAmount: "10000",
        monthlyContribution: "500",
        priority: 1,
        isActive: true,
        apiCategoryId: "cat-456",
        apiCategoryName: "Rainy Day Fund",
      })
      .returning()
      .get();
    goalId = goal.id;
  });

  afterAll(() => cleanup());

  // ── BUDGET ITEM RENAME ──

  describe("renameBudgetItemToApi", () => {
    it("renames subcategory to match API name", async () => {
      const result = await caller.sync.renameBudgetItemToApi({
        budgetItemId,
      });
      expect(result).toEqual({ ok: true, newName: "Food & Drink" });
    });

    it("throws for item without apiCategoryName", async () => {
      // Create an item without apiCategoryName
      const schema = await import("@/lib/db/schema-sqlite");
      const profiles = db.select().from(schema.budgetProfiles).all();
      const noApiItem = db
        .insert(schema.budgetItems)
        .values({
          profileId: profiles[0]!.id,
          category: "Utils",
          subcategory: "Electric",
          amounts: [50],
          isLinked: false,
        })
        .returning()
        .get();

      await expect(
        caller.sync.renameBudgetItemToApi({
          budgetItemId: noApiItem.id,
        }),
      ).rejects.toThrow("Item not linked to API category");
    });
  });

  describe("renameBudgetItemApiName", () => {
    it("updates apiCategoryName to match subcategory", async () => {
      const result = await caller.sync.renameBudgetItemApiName({
        budgetItemId,
      });
      // After the previous test renamed subcategory to "Food & Drink",
      // this should set apiCategoryName to "Food & Drink"
      expect(result.ok).toBe(true);
      expect(result.newApiName).toBe("Food & Drink");
    });

    it("throws for non-existent budget item", async () => {
      await expect(
        caller.sync.renameBudgetItemApiName({ budgetItemId: 99999 }),
      ).rejects.toThrow("Budget item not found");
    });
  });

  describe("moveBudgetItemToApiGroup", () => {
    it("moves item to new category group", async () => {
      const result = await caller.sync.moveBudgetItemToApiGroup({
        budgetItemId,
        apiGroupName: "Food",
      });
      expect(result).toEqual({ ok: true });
    });
  });

  // ── SAVINGS GOAL RENAME ──

  describe("renameSavingsGoalToApi", () => {
    it("renames goal name to match API name", async () => {
      const result = await caller.sync.renameSavingsGoalToApi({
        goalId,
      });
      expect(result).toEqual({ ok: true, newName: "Rainy Day Fund" });
    });

    it("throws for goal without apiCategoryName", async () => {
      const schema = await import("@/lib/db/schema-sqlite");
      const noApiGoal = db
        .insert(schema.savingsGoals)
        .values({
          name: "Vacation",
          targetAmount: "5000",
          monthlyContribution: "200",
          priority: 2,
          isActive: true,
        })
        .returning()
        .get();

      await expect(
        caller.sync.renameSavingsGoalToApi({ goalId: noApiGoal.id }),
      ).rejects.toThrow("Goal not linked to API category");
    });
  });

  describe("renameSavingsGoalApiName", () => {
    it("updates apiCategoryName to match goal name", async () => {
      const result = await caller.sync.renameSavingsGoalApiName({
        goalId,
      });
      // After previous test renamed to "Rainy Day Fund"
      expect(result.ok).toBe(true);
      expect(result.newApiName).toBe("Rainy Day Fund");
    });

    it("throws for non-existent goal", async () => {
      await expect(
        caller.sync.renameSavingsGoalApiName({ goalId: 99999 }),
      ).rejects.toThrow("Savings goal not found");
    });
  });

  // ── SYNC ALL NAMES ──

  describe("syncAllNames", () => {
    it("returns zero counts with no drifted items (pull)", async () => {
      const result = await caller.sync.syncAllNames({
        direction: "pull",
      });
      expect(result.ok).toBe(true);
      expect(typeof result.budgetRenamed).toBe("number");
      expect(typeof result.savingsRenamed).toBe("number");
      expect(typeof result.categoriesMoved).toBe("number");
    });

    it("returns zero counts with keepLedgr direction", async () => {
      const result = await caller.sync.syncAllNames({
        direction: "keepLedgr",
      });
      expect(result.ok).toBe(true);
    });
  });
});
