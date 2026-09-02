/**
 * Additional sync-names coverage tests — targets uncovered lines/branches
 * in syncAllNames and edge cases.
 *
 * All budget-item/savings-goal "linked to API" state is seeded via the real
 * budget_item_category_links / savings_goal_category_links tables (not the
 * dead apiCategoryId/apiCategoryName columns) — see
 * src/server/helpers/category-links.ts.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";

// Use vi.hoisted so mock fns are available in the hoisted vi.mock factory
const { mockGetActiveBudgetApi, mockCacheGet } = vi.hoisted(() => ({
  mockGetActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  mockCacheGet: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: mockGetActiveBudgetApi,
  cacheGet: mockCacheGet,
}));

import {
  createTestCaller,
  adminSession,
  seedBudgetProfile,
  seedBudgetItem,
  seedSavingsGoal,
} from "./setup";

/** Link a seeded budget item to a service's category via the real link table. */
async function linkBudgetItem(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  budgetItemId: number,
  service: "ynab" | "actual",
  categoryId: string,
  categoryName: string | null,
) {
  const schema = await import("@/lib/db/schema-sqlite");
  db.insert(schema.budgetItemCategoryLinks)
    .values({ budgetItemId, service, categoryId, categoryName })
    .run();
}

/** Link a seeded savings goal to a service's category via the real link table. */
async function linkSavingsGoal(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  savingsGoalId: number,
  service: "ynab" | "actual",
  categoryId: string,
  categoryName: string | null,
) {
  const schema = await import("@/lib/db/schema-sqlite");
  db.insert(schema.savingsGoalCategoryLinks)
    .values({
      savingsGoalId,
      service,
      role: "primary",
      categoryId,
      categoryName,
    })
    .run();
}

describe("sync-names coverage", () => {
  // ── syncAllNames: pull with cached API data (name drift + category group drift) ──

  describe("syncAllNames pull with cached categories", () => {
    it("renames drifted budget items and moves category groups from cache", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Item with name drift AND category group drift
        const itemA = seedBudgetItem(db, profileId, {
          subcategory: "Old Groceries",
          category: "OldGroup",
        });
        await linkBudgetItem(db, itemA, "ynab", "cat-aaa", "Old Groceries");

        // Item with ONLY category group drift (name matches cache)
        const itemB = seedBudgetItem(db, profileId, {
          subcategory: "Utilities",
          category: "WrongGroup",
        });
        await linkBudgetItem(db, itemB, "ynab", "cat-bbb", "Utilities");

        // Savings goal with name drift
        const goal = seedSavingsGoal(db, { name: "Old Goal Name" });
        await linkSavingsGoal(db, goal, "ynab", "cat-ccc", "Old Goal Name");

        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "NewGroup",
              categories: [
                { id: "cat-aaa", name: "Fresh Groceries" },
                { id: "cat-bbb", name: "Utilities" }, // name matches, but group differs
              ],
            },
            {
              name: "SavingsGroup",
              categories: [{ id: "cat-ccc", name: "New Goal Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
          includeCategories: true,
        });

        expect(result.ok).toBe(true);
        // cat-aaa: name drift (Old Groceries -> Fresh Groceries) + group drift (OldGroup -> NewGroup)
        // cat-bbb: no name drift, but group drift (WrongGroup -> NewGroup)
        expect(result.budgetRenamed).toBe(1); // only cat-aaa has name drift
        expect(result.categoriesMoved).toBe(2); // both items have group drift
        expect(result.savingsRenamed).toBe(1); // savings goal name drifted
      } finally {
        cleanup();
      }
    });

    it("does NOT move categories when includeCategories is false", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        const item = seedBudgetItem(db, profileId, {
          subcategory: "Old Name",
          category: "WrongGroup",
        });
        await linkBudgetItem(db, item, "ynab", "cat-ddd", "Old Name");

        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "CorrectGroup",
              categories: [{ id: "cat-ddd", name: "New Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
          includeCategories: false,
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);
        expect(result.categoriesMoved).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: keepLedgr with drifted items ──

  describe("syncAllNames keepLedgr with drifted items", () => {
    it("updates apiCategoryName to match subcategory for budget items", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Budget item where subcategory differs from the linked category name
        const item = seedBudgetItem(db, profileId, {
          subcategory: "My Groceries",
          category: "Food",
        });
        await linkBudgetItem(db, item, "ynab", "cat-111", "API Groceries");

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "keepLedgr",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);
        expect(result.categoriesMoved).toBe(0); // keepLedgr never moves categories
      } finally {
        cleanup();
      }
    });

    it("updates apiCategoryName to match goal name for savings goals", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // No budget drift
        const item = seedBudgetItem(db, profileId, {
          subcategory: "Same",
          category: "Food",
        });
        await linkBudgetItem(db, item, "ynab", "cat-222", "Same");

        // Savings goal with name drift
        const goal = seedSavingsGoal(db, { name: "My Emergency" });
        await linkSavingsGoal(db, goal, "ynab", "cat-333", "API Emergency");

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "keepLedgr",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(0);
        expect(result.savingsRenamed).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: pull with savings goal drift ──

  describe("syncAllNames pull with savings goal drift", () => {
    it("renames savings goals to match cached API name", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const goal = seedSavingsGoal(db, { name: "Old Savings Name" });
        await linkSavingsGoal(
          db,
          goal,
          "actual",
          "cat-goal-1",
          "Old Savings Name",
        );

        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "Savings Group",
              categories: [{ id: "cat-goal-1", name: "New Savings Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "actual",
          direction: "pull",
          includeCategories: true,
        });

        expect(result.ok).toBe(true);
        expect(result.savingsRenamed).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("skips savings goals with no drift", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const goal = seedSavingsGoal(db, { name: "Matching Name" });
        await linkSavingsGoal(db, goal, "ynab", "cat-goal-2", "Matching Name");

        // No cache data, so stored category name is used — it matches name
        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
        });

        expect(result.ok).toBe(true);
        expect(result.savingsRenamed).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: explicit service parameter ──

  describe("syncAllNames with explicit service", () => {
    it("uses the provided service for the cache lookup", async () => {
      mockGetActiveBudgetApi.mockClear();
      mockCacheGet.mockClear();

      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        const item = seedBudgetItem(db, profileId, {
          subcategory: "Original",
          category: "Bills",
        });
        await linkBudgetItem(db, item, "actual", "cat-svc", "Original");

        // cacheGet should be called with "actual" (the explicit service)
        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "Bills",
              categories: [{ id: "cat-svc", name: "Updated" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "actual",
          direction: "pull",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);
        // service is now a required input — getActiveBudgetApi is never
        // consulted for syncAllNames at all (see sync/names.ts).
        expect(mockGetActiveBudgetApi).not.toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });

    it("rejects a call with no service — required input, no silent fallback to active", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        await seedBudgetProfile(db);
        await expect(
          caller.sync.syncAllNames({
            // @ts-expect-error intentionally omitted — service is required
            direction: "pull",
          }),
        ).rejects.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: budget item with a link but no cache entry (fallback to stored name) ──

  describe("syncAllNames cache miss fallback", () => {
    it("falls back to stored apiCategoryName when cache has no entry for apiCategoryId", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Item is linked but cache won't have an entry for it — falls back
        // to the stored category name.
        const item = seedBudgetItem(db, profileId, {
          subcategory: "Local Name",
          category: "Food",
        });
        await linkBudgetItem(
          db,
          item,
          "ynab",
          "cat-missing",
          "Stored API Name",
        );

        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "OtherGroup",
              categories: [{ id: "cat-other", name: "Something Else" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
          includeCategories: true,
        });

        expect(result.ok).toBe(true);
        // Name drift: "Local Name" != "Stored API Name" (fallback), so it gets renamed
        expect(result.budgetRenamed).toBe(1);
        // No category move because cache has no entry for "cat-missing"
        expect(result.categoriesMoved).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: item with null apiCategoryName and no cache hit ──

  describe("syncAllNames null apiCategoryName", () => {
    it("skips items where currentApiName is null (no cache + null stored name)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Item is linked (so it passes the "has a link" filter) but with a
        // null category name.
        const item = seedBudgetItem(db, profileId, {
          subcategory: "Something",
          category: "Bills",
        });
        await linkBudgetItem(db, item, "ynab", "cat-nullname", null);

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: savings goal with null apiCategoryName skipped ──

  describe("syncAllNames savings goal null apiCategoryName", () => {
    it("skips goals where currentGoalApiName is null", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const goal = seedSavingsGoal(db, { name: "Some Goal" });
        await linkSavingsGoal(db, goal, "ynab", "cat-nullgoal", null);

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "keepLedgr",
        });

        expect(result.ok).toBe(true);
        expect(result.savingsRenamed).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: service is active but cache is null ──

  describe("syncAllNames pull with active service but null cache", () => {
    it("falls back to stored names when cacheGet returns null", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        const item = seedBudgetItem(db, profileId, {
          subcategory: "Local",
          category: "Bills",
        });
        await linkBudgetItem(db, item, "ynab", "cat-nocache", "Stored Name");

        mockCacheGet.mockResolvedValueOnce(null);

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
          includeCategories: true,
        });

        expect(result.ok).toBe(true);
        // Falls back to stored apiCategoryName "Stored Name" != "Local"
        expect(result.budgetRenamed).toBe(1);
        expect(result.categoriesMoved).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── renameBudgetItemToApi: non-existent item ──

  describe("renameBudgetItemToApi edge cases", () => {
    it("throws for non-existent budget item ID", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        await expect(
          caller.sync.renameBudgetItemToApi({
            budgetItemId: 99999,
            service: "ynab",
          }),
        ).rejects.toThrow("Item not linked to API category");
      } finally {
        cleanup();
      }
    });
  });

  // ── renameSavingsGoalToApi: non-existent goal ──

  describe("renameSavingsGoalToApi edge cases", () => {
    it("throws for non-existent goal ID", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        await expect(
          caller.sync.renameSavingsGoalToApi({
            goalId: 99999,
            service: "ynab",
          }),
        ).rejects.toThrow("Goal not linked to API category");
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: cross-service isolation — the core fix ──

  describe("syncAllNames cross-service isolation", () => {
    it("renaming via YNAB does not touch the SAME item's Actual link", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        const item = seedBudgetItem(db, profileId, {
          subcategory: "Stale Name",
          category: "Bills",
        });
        await linkBudgetItem(db, item, "ynab", "cat-auto", "Stale Name");
        await linkBudgetItem(
          db,
          item,
          "actual",
          "cat-auto-actual",
          "Actual Name",
        );

        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "Bills",
              categories: [{ id: "cat-auto", name: "Fresh Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          service: "ynab",
          direction: "pull",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);

        const { loadBudgetItemLinks } =
          await import("@/server/helpers/category-links");
        // eslint-disable-next-line no-restricted-syntax -- test-only cast to the pg Db type the helper expects
        const rawDb = db as unknown as Parameters<
          typeof loadBudgetItemLinks
        >[0];
        const actualLinks = await loadBudgetItemLinks(rawDb, [item], "actual");
        expect(actualLinks.get(item)?.categoryName).toBe("Actual Name");
      } finally {
        mockGetActiveBudgetApi.mockClear();
        mockCacheGet.mockClear();
        cleanup();
      }
    });
  });
});
