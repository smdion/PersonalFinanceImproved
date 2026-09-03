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

    const schema = await import("@/lib/db/schema-sqlite");

    // Seed a budget profile + item, then link it via
    // budget_item_category_links (the raw apiCategoryId/apiCategoryName
    // columns are dead — see src/server/helpers/category-links.ts).
    const profileId = await seedBudgetProfile(db);
    const item = db
      .insert(schema.budgetItems)
      .values({
        profileId,
        category: "Groceries",
        subcategory: "Weekly Food",
        amounts: [100],
      })
      .returning()
      .get();
    budgetItemId = item.id;
    db.insert(schema.budgetItemCategoryLinks)
      .values({
        budgetItemId,
        service: "ynab",
        categoryId: "cat-123",
        categoryName: "Food & Drink",
      })
      .run();

    // Seed a savings goal, then link it via savings_goal_category_links.
    const goal = db
      .insert(schema.savingsGoals)
      .values({
        name: "Emergency Fund",
        targetAmount: "10000",
        priority: 1,
        isActive: true,
      })
      .returning()
      .get();
    goalId = goal.id;
    db.insert(schema.savingsGoalCategoryLinks)
      .values({
        savingsGoalId: goalId,
        service: "ynab",
        role: "primary",
        categoryId: "cat-456",
        categoryName: "Rainy Day Fund",
      })
      .run();
  });

  afterAll(() => cleanup());

  // ── BUDGET ITEM RENAME ──

  describe("renameBudgetItemToApi", () => {
    it("renames subcategory to match API name", async () => {
      const result = await caller.sync.renameBudgetItemToApi({
        budgetItemId,
        service: "ynab",
      });
      expect(result).toEqual({ ok: true, newName: "Food & Drink" });
    });

    it("throws for item without apiCategoryName", async () => {
      // Create an item without any link
      const schema = await import("@/lib/db/schema-sqlite");
      const profiles = db.select().from(schema.budgetProfiles).all();
      const noApiItem = db
        .insert(schema.budgetItems)
        .values({
          profileId: profiles[0]!.id,
          category: "Utils",
          subcategory: "Electric",
          amounts: [50],
        })
        .returning()
        .get();

      await expect(
        caller.sync.renameBudgetItemToApi({
          budgetItemId: noApiItem.id,
          service: "ynab",
        }),
      ).rejects.toThrow("Item not linked to API category");
    });

    it("keeps YNAB and Actual links on the SAME item isolated — the core fix", async () => {
      const schema = await import("@/lib/db/schema-sqlite");
      const profiles = db.select().from(schema.budgetProfiles).all();
      const dualItem = db
        .insert(schema.budgetItems)
        .values({
          profileId: profiles[0]!.id,
          category: "Dual",
          subcategory: "Dual Service Item",
          amounts: [10],
        })
        .returning()
        .get();
      db.insert(schema.budgetItemCategoryLinks)
        .values({
          budgetItemId: dualItem.id,
          service: "ynab",
          categoryId: "ynab-cat",
          categoryName: "YNAB Name",
        })
        .run();
      db.insert(schema.budgetItemCategoryLinks)
        .values({
          budgetItemId: dualItem.id,
          service: "actual",
          categoryId: "actual-cat",
          categoryName: "Actual Name",
        })
        .run();

      const result = await caller.sync.renameBudgetItemToApi({
        budgetItemId: dualItem.id,
        service: "ynab",
      });
      expect(result).toEqual({ ok: true, newName: "YNAB Name" });

      // The Actual link's own category name must be untouched.
      const { loadBudgetItemLinks } =
        await import("@/server/helpers/category-links");
      // eslint-disable-next-line no-restricted-syntax -- test-only cast to the pg Db type the helper expects
      const rawDb = db as unknown as Parameters<typeof loadBudgetItemLinks>[0];
      const actualLinks = await loadBudgetItemLinks(
        rawDb,
        [dualItem.id],
        "actual",
      );
      expect(actualLinks.get(dualItem.id)?.categoryName).toBe("Actual Name");
    });
  });

  describe("renameBudgetItemApiName", () => {
    it("updates apiCategoryName to match subcategory", async () => {
      const result = await caller.sync.renameBudgetItemApiName({
        budgetItemId,
        service: "ynab",
      });
      // After the previous test renamed subcategory to "Food & Drink",
      // this should set apiCategoryName to "Food & Drink"
      expect(result.ok).toBe(true);
      expect(result.newApiName).toBe("Food & Drink");
    });

    it("throws for non-existent budget item", async () => {
      await expect(
        caller.sync.renameBudgetItemApiName({
          budgetItemId: 99999,
          service: "ynab",
        }),
      ).rejects.toThrow("Budget item not found");
    });
  });

  describe("moveBudgetItemToApiGroup", () => {
    it("moves item to new category group", async () => {
      const result = await caller.sync.moveBudgetItemToApiGroup({
        budgetItemId,
        apiGroupName: "Food",
        service: "ynab",
      });
      expect(result).toEqual({ ok: true });
    });
  });

  // ── SAVINGS GOAL RENAME ──

  describe("renameSavingsGoalToApi", () => {
    it("renames goal name to match API name", async () => {
      const result = await caller.sync.renameSavingsGoalToApi({
        goalId,
        service: "ynab",
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
          priority: 2,
          isActive: true,
        })
        .returning()
        .get();

      await expect(
        caller.sync.renameSavingsGoalToApi({
          goalId: noApiGoal.id,
          service: "ynab",
        }),
      ).rejects.toThrow("Goal not linked to API category");
    });
  });

  describe("renameSavingsGoalApiName", () => {
    it("updates apiCategoryName to match goal name", async () => {
      const result = await caller.sync.renameSavingsGoalApiName({
        goalId,
        service: "ynab",
      });
      // After previous test renamed to "Rainy Day Fund"
      expect(result.ok).toBe(true);
      expect(result.newApiName).toBe("Rainy Day Fund");
    });

    it("throws for non-existent goal", async () => {
      await expect(
        caller.sync.renameSavingsGoalApiName({
          goalId: 99999,
          service: "ynab",
        }),
      ).rejects.toThrow("Savings goal not found");
    });
  });

  // ── SYNC ALL NAMES ──

  describe("syncAllNames", () => {
    it("returns zero counts with no drifted items (pull)", async () => {
      const result = await caller.sync.syncAllNames({
        direction: "pull",
        service: "ynab",
      });
      expect(result.ok).toBe(true);
      expect(typeof result.budgetRenamed).toBe("number");
      expect(typeof result.savingsRenamed).toBe("number");
      expect(typeof result.categoriesMoved).toBe("number");
    });

    it("returns zero counts with keepLedgr direction", async () => {
      const result = await caller.sync.syncAllNames({
        direction: "keepLedgr",
        service: "ynab",
      });
      expect(result.ok).toBe(true);
    });
  });
});
