/**
 * Additional sync-names coverage tests — targets uncovered lines/branches
 * in syncAllNames (lines 196-197, 201-206, 226-240) and edge cases.
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

describe("sync-names coverage", () => {
  // ── syncAllNames: pull with cached API data (name drift + category group drift) ──

  describe("syncAllNames pull with cached categories", () => {
    it("renames drifted budget items and moves category groups from cache (lines 196-202)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Item with name drift AND category group drift
        seedBudgetItem(db, profileId, {
          subcategory: "Old Groceries",
          category: "OldGroup",
          apiCategoryId: "cat-aaa",
          apiCategoryName: "Old Groceries",
        });

        // Item with ONLY category group drift (name matches cache)
        seedBudgetItem(db, profileId, {
          subcategory: "Utilities",
          category: "WrongGroup",
          apiCategoryId: "cat-bbb",
          apiCategoryName: "Utilities",
        });

        // Savings goal with name drift
        seedSavingsGoal(db, {
          name: "Old Goal Name",
          apiCategoryId: "cat-ccc",
          apiCategoryName: "Old Goal Name",
        });

        // Mock: getActiveBudgetApi returns "ynab" and cacheGet returns category data
        mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
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

        seedBudgetItem(db, profileId, {
          subcategory: "Old Name",
          category: "WrongGroup",
          apiCategoryId: "cat-ddd",
          apiCategoryName: "Old Name",
        });

        mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "CorrectGroup",
              categories: [{ id: "cat-ddd", name: "New Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
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

  // ── syncAllNames: keepLedgr with drifted items (lines 182-184, 234-238) ──

  describe("syncAllNames keepLedgr with drifted items", () => {
    it("updates apiCategoryName to match subcategory for budget items (line 183)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Budget item where subcategory differs from apiCategoryName
        seedBudgetItem(db, profileId, {
          subcategory: "My Groceries",
          category: "Food",
          apiCategoryId: "cat-111",
          apiCategoryName: "API Groceries",
        });

        const result = await caller.sync.syncAllNames({
          direction: "keepLedgr",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);
        expect(result.categoriesMoved).toBe(0); // keepLedgr never moves categories
      } finally {
        cleanup();
      }
    });

    it("updates apiCategoryName to match goal name for savings goals (lines 234-238)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // No budget drift
        seedBudgetItem(db, profileId, {
          subcategory: "Same",
          category: "Food",
          apiCategoryId: "cat-222",
          apiCategoryName: "Same",
        });

        // Savings goal with name drift
        seedSavingsGoal(db, {
          name: "My Emergency",
          apiCategoryId: "cat-333",
          apiCategoryName: "API Emergency",
        });

        const result = await caller.sync.syncAllNames({
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

  // ── syncAllNames: pull with savings goal drift (lines 226-233) ──

  describe("syncAllNames pull with savings goal drift", () => {
    it("renames savings goals to match cached API name (lines 226-233)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        // Savings goal with drifted name
        seedSavingsGoal(db, {
          name: "Old Savings Name",
          apiCategoryId: "cat-goal-1",
          apiCategoryName: "Old Savings Name",
        });

        mockGetActiveBudgetApi.mockResolvedValueOnce("actual");
        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "Savings Group",
              categories: [{ id: "cat-goal-1", name: "New Savings Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
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
        seedSavingsGoal(db, {
          name: "Matching Name",
          apiCategoryId: "cat-goal-2",
          apiCategoryName: "Matching Name",
        });

        // No cache data, so stored apiCategoryName is used — it matches name
        const result = await caller.sync.syncAllNames({
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
    it("uses provided service instead of getActiveBudgetApi (line 148)", async () => {
      // Clear call history from prior tests
      mockGetActiveBudgetApi.mockClear();
      mockCacheGet.mockClear();

      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        seedBudgetItem(db, profileId, {
          subcategory: "Original",
          category: "Bills",
          apiCategoryId: "cat-svc",
          apiCategoryName: "Original",
        });

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
        // getActiveBudgetApi should NOT have been called (service was explicit)
        expect(mockGetActiveBudgetApi).not.toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: budget item with apiCategoryId but no cache entry (fallback to stored name) ──

  describe("syncAllNames cache miss fallback", () => {
    it("falls back to stored apiCategoryName when cache has no entry for apiCategoryId", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        // Item has apiCategoryId but cache won't have it — falls back to stored apiCategoryName
        seedBudgetItem(db, profileId, {
          subcategory: "Local Name",
          category: "Food",
          apiCategoryId: "cat-missing",
          apiCategoryName: "Stored API Name",
        });

        mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "OtherGroup",
              categories: [{ id: "cat-other", name: "Something Else" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
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

        // Item has apiCategoryId (so it passes the isNotNull filter) but null apiCategoryName
        seedBudgetItem(db, profileId, {
          subcategory: "Something",
          category: "Bills",
          apiCategoryId: "cat-nullname",
          apiCategoryName: null,
        });

        const result = await caller.sync.syncAllNames({
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
        seedSavingsGoal(db, {
          name: "Some Goal",
          apiCategoryId: "cat-nullgoal",
          apiCategoryName: null,
        });

        const result = await caller.sync.syncAllNames({
          direction: "keepLedgr",
        });

        expect(result.ok).toBe(true);
        expect(result.savingsRenamed).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: service is active but cache is null (line 155 false branch) ──

  describe("syncAllNames pull with active service but null cache", () => {
    it("falls back to stored names when cacheGet returns null (line 155)", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        seedBudgetItem(db, profileId, {
          subcategory: "Local",
          category: "Bills",
          apiCategoryId: "cat-nocache",
          apiCategoryName: "Stored Name",
        });

        // Service is active but cache is null
        mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
        mockCacheGet.mockResolvedValueOnce(null);

        const result = await caller.sync.syncAllNames({
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
          caller.sync.renameBudgetItemToApi({ budgetItemId: 99999 }),
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
          caller.sync.renameSavingsGoalToApi({ goalId: 99999 }),
        ).rejects.toThrow("Goal not linked to API category");
      } finally {
        cleanup();
      }
    });
  });

  // ── syncAllNames: pull direction where getActiveBudgetApi is called (no explicit service) ──

  describe("syncAllNames pull without explicit service", () => {
    it("calls getActiveBudgetApi when no service provided and renames drifted items", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = await seedBudgetProfile(db);

        seedBudgetItem(db, profileId, {
          subcategory: "Stale Name",
          category: "Bills",
          apiCategoryId: "cat-auto",
          apiCategoryName: "Stale Name",
        });

        mockGetActiveBudgetApi.mockResolvedValueOnce("ynab");
        mockCacheGet.mockResolvedValueOnce({
          data: [
            {
              name: "Bills",
              categories: [{ id: "cat-auto", name: "Fresh Name" }],
            },
          ],
        });

        const result = await caller.sync.syncAllNames({
          direction: "pull",
        });

        expect(result.ok).toBe(true);
        expect(result.budgetRenamed).toBe(1);
      } finally {
        mockGetActiveBudgetApi.mockClear();
        mockCacheGet.mockClear();
        cleanup();
      }
    });
  });
});
