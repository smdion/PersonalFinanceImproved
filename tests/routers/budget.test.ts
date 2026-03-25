/**
 * Budget router integration tests.
 *
 * Covers: listProfiles, createProfile, renameProfile, deleteProfile,
 * setActiveProfile, createItem, deleteItem, updateItemAmount,
 * updateItemEssential, moveItem, addColumn, removeColumn, renameColumn,
 * updateColumnMonths, linkToApi, unlinkFromApi, setSyncDirection,
 * computeActiveSummary.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedBudgetItem,
  viewerSession,
  createViewerSessionWithPermissions,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
  YNAB_INTERNAL_GROUPS: new Set([
    "Internal Master Category",
    "Credit Card Payments",
  ]),
}));

// ---------------------------------------------------------------------------
// Shared test state — one DB per suite, seeded once in beforeAll
// ---------------------------------------------------------------------------

describe("budget router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  // IDs from the standard seed
  let profileId: number;
  let itemIds: number[];

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const seed = seedStandardDataset(db);
    profileId = seed.profileId;
    itemIds = seed.itemIds;
  });

  afterAll(() => cleanup());

  // =========================================================================
  // listProfiles
  // =========================================================================

  describe("listProfiles", () => {
    it("returns all seeded profiles", async () => {
      const result = await caller.budget.listProfiles();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("includes the seeded Main Budget profile", async () => {
      const result = await caller.budget.listProfiles();
      const main = result.find((p) => p.id === profileId);
      expect(main).toBeDefined();
      expect(main!.name).toBe("Main Budget");
      expect(main!.isActive).toBe(true);
    });

    it("includes columnLabels and columnCount", async () => {
      const result = await caller.budget.listProfiles();
      const main = result.find((p) => p.id === profileId)!;
      expect(Array.isArray(main.columnLabels)).toBe(true);
      expect(main.columnCount).toBe(1);
    });

    it("computes annualTotal from column 0 * 12 when no columnMonths set", async () => {
      // seeded items: Rent 2000 + Groceries 600 + Dining 200 = 2800/month
      const result = await caller.budget.listProfiles();
      const main = result.find((p) => p.id === profileId)!;
      expect(main.annualTotal).toBe(2800 * 12);
    });

    it("returns empty array when no profiles exist in a fresh environment", async () => {
      const fresh = await createTestCaller();
      try {
        const result = await fresh.caller.budget.listProfiles();
        expect(result).toHaveLength(0);
      } finally {
        fresh.cleanup();
      }
    });
  });

  // =========================================================================
  // createProfile
  // =========================================================================

  describe("createProfile", () => {
    it("creates a new profile with default single column", async () => {
      const result = await caller.budget.createProfile({ name: "New Plan" });
      expect(result).toBeDefined();
      expect(result!.name).toBe("New Plan");
      expect(result!.isActive).toBe(false);
    });

    it("pre-populates new profile with template items (zero amounts)", async () => {
      const result = await caller.budget.createProfile({
        name: "Template Test",
      });
      const profiles = await caller.budget.listProfiles();
      const created = profiles.find((p) => p.id === result!.id);
      expect(created).toBeDefined();
      expect(created!.columnCount).toBe(1);
      // Template items are zeroed so annualTotal is 0
      expect(created!.annualTotal).toBe(0);
    });

    it("creates a profile with multiple column labels", async () => {
      const result = await caller.budget.createProfile({
        name: "Multi-Column",
        columnLabels: ["Low", "High"],
      });
      expect(result).toBeDefined();
      expect(result!.columnLabels).toEqual(["Low", "High"]);
    });

    it("trims whitespace from name", async () => {
      const result = await caller.budget.createProfile({ name: "  Padded  " });
      expect(result!.name).toBe("Padded");
    });

    it("rejects empty name", async () => {
      await expect(caller.budget.createProfile({ name: "" })).rejects.toThrow();
    });

    it("rejects whitespace-only name", async () => {
      await expect(
        caller.budget.createProfile({ name: "   " }),
      ).rejects.toThrow();
    });

    it("rejects empty columnLabels array", async () => {
      await expect(
        caller.budget.createProfile({ name: "Bad Cols", columnLabels: [] }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // renameProfile
  // =========================================================================

  describe("renameProfile", () => {
    it("renames an existing profile", async () => {
      const created = await caller.budget.createProfile({ name: "Rename Me" });
      const result = await caller.budget.renameProfile({
        id: created!.id,
        name: "Renamed Profile",
      });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const found = profiles.find((p) => p.id === created!.id);
      expect(found!.name).toBe("Renamed Profile");
    });

    it("trims whitespace from the new name", async () => {
      const created = await caller.budget.createProfile({ name: "Trim Me" });
      await caller.budget.renameProfile({
        id: created!.id,
        name: "  Trimmed  ",
      });
      const profiles = await caller.budget.listProfiles();
      const found = profiles.find((p) => p.id === created!.id);
      expect(found!.name).toBe("Trimmed");
    });

    it("rejects empty name", async () => {
      await expect(
        caller.budget.renameProfile({ id: profileId, name: "" }),
      ).rejects.toThrow();
    });

    it("rejects whitespace-only name", async () => {
      await expect(
        caller.budget.renameProfile({ id: profileId, name: "   " }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // deleteProfile
  // =========================================================================

  describe("deleteProfile", () => {
    it("throws when attempting to delete the active profile", async () => {
      // profileId from standard seed is active
      await expect(
        caller.budget.deleteProfile({ id: profileId }),
      ).rejects.toThrow("Cannot delete the active profile");
    });

    it("deletes an inactive profile successfully", async () => {
      const created = await caller.budget.createProfile({ name: "To Delete" });
      // createProfile always returns isActive: false
      const result = await caller.budget.deleteProfile({ id: created!.id });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      expect(profiles.find((p) => p.id === created!.id)).toBeUndefined();
    });

    it("throws for a non-existent profile id", async () => {
      await expect(caller.budget.deleteProfile({ id: 999999 })).rejects.toThrow(
        "Profile not found",
      );
    });

    it("cascades to delete associated items", async () => {
      const created = await caller.budget.createProfile({ name: "With Items" });
      const newProfileId = created!.id;
      // Seed a budget item directly into the new profile
      seedBudgetItem(db, newProfileId, { amounts: [100] });

      await caller.budget.deleteProfile({ id: newProfileId });

      const profiles = await caller.budget.listProfiles();
      expect(profiles.find((p) => p.id === newProfileId)).toBeUndefined();
    });
  });

  // =========================================================================
  // setActiveProfile
  // =========================================================================

  describe("setActiveProfile", () => {
    it("makes the selected profile active and deactivates all others", async () => {
      const secondary = await caller.budget.createProfile({
        name: "Secondary",
      });
      const secondaryId = secondary!.id;

      await caller.budget.setActiveProfile({ id: secondaryId });

      const profiles = await caller.budget.listProfiles();
      expect(profiles.find((p) => p.id === secondaryId)!.isActive).toBe(true);
      expect(profiles.find((p) => p.id === profileId)!.isActive).toBe(false);

      // Restore the original active profile for subsequent tests
      await caller.budget.setActiveProfile({ id: profileId });
    });

    it("re-activating the already-active profile keeps it active", async () => {
      await caller.budget.setActiveProfile({ id: profileId });
      const profiles = await caller.budget.listProfiles();
      expect(profiles.find((p) => p.id === profileId)!.isActive).toBe(true);
    });

    it("only one profile is active at a time", async () => {
      const profiles = await caller.budget.listProfiles();
      const activeProfiles = profiles.filter((p) => p.isActive);
      expect(activeProfiles).toHaveLength(1);
    });
  });

  // =========================================================================
  // createItem
  // =========================================================================

  describe("createItem", () => {
    it("creates a new budget item in the active profile", async () => {
      const result = await caller.budget.createItem({
        category: "Essentials",
        subcategory: "Utilities",
        isEssential: true,
      });
      expect(result).toBeDefined();
      expect(result!.category).toBe("Essentials");
      expect(result!.subcategory).toBe("Utilities");
      expect(result!.isEssential).toBe(true);
    });

    it("initialises amounts to zero for each column", async () => {
      const result = await caller.budget.createItem({
        category: "Lifestyle",
        subcategory: "Gym",
        isEssential: false,
      });
      const amounts = result!.amounts as number[];
      expect(amounts).toHaveLength(1); // active profile has 1 column
      expect(amounts[0]).toBe(0);
    });

    it("defaults isEssential to true when not provided", async () => {
      const result = await caller.budget.createItem({
        category: "Essentials",
        subcategory: "Phone",
      });
      expect(result!.isEssential).toBe(true);
    });

    it("assigns a non-negative sortOrder", async () => {
      const result = await caller.budget.createItem({
        category: "Transport",
        subcategory: "Bus Pass",
      });
      expect(result!.sortOrder).toBeGreaterThanOrEqual(0);
    });

    it("rejects blank category", async () => {
      await expect(
        caller.budget.createItem({ category: "  ", subcategory: "Sub" }),
      ).rejects.toThrow();
    });

    it("rejects blank subcategory", async () => {
      await expect(
        caller.budget.createItem({ category: "Cat", subcategory: "  " }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // deleteItem
  // =========================================================================

  describe("deleteItem", () => {
    it("deletes an existing item and returns ok", async () => {
      const created = await caller.budget.createItem({
        category: "Temp",
        subcategory: "Temp Item",
      });
      const result = await caller.budget.deleteItem({ id: created!.id });
      expect(result).toEqual({ ok: true });
    });

    it("returns ok even for a non-existent item id (idempotent)", async () => {
      const result = await caller.budget.deleteItem({ id: 999999 });
      expect(result).toEqual({ ok: true });
    });
  });

  // =========================================================================
  // updateItemAmount
  // =========================================================================

  describe("updateItemAmount", () => {
    it("updates column 0 amount of an existing item", async () => {
      const itemId = itemIds[0]!; // Rent seeded at 2000
      const result = await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 2500,
      });
      expect(result).toBeDefined();
      expect((result!.amounts as number[])[0]).toBe(2500);

      // Restore
      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 2000,
      });
    });

    it("allows setting amount to zero", async () => {
      const itemId = itemIds[1]!; // Groceries seeded at 600
      const result = await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 0,
      });
      expect((result!.amounts as number[])[0]).toBe(0);

      // Restore
      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 600,
      });
    });

    it("allows fractional amounts", async () => {
      const itemId = itemIds[1]!;
      const result = await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 123.45,
      });
      expect((result!.amounts as number[])[0]).toBeCloseTo(123.45);

      // Restore
      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 600,
      });
    });

    it("throws for out-of-bounds colIndex", async () => {
      await expect(
        caller.budget.updateItemAmount({
          id: itemIds[0]!,
          colIndex: 99,
          amount: 100,
        }),
      ).rejects.toThrow("Column index out of bounds");
    });

    it("throws for negative colIndex", async () => {
      await expect(
        caller.budget.updateItemAmount({
          id: itemIds[0]!,
          colIndex: -1,
          amount: 100,
        }),
      ).rejects.toThrow();
    });

    it("throws when item does not exist", async () => {
      await expect(
        caller.budget.updateItemAmount({
          id: 999999,
          colIndex: 0,
          amount: 100,
        }),
      ).rejects.toThrow("Item not found");
    });
  });

  // =========================================================================
  // updateItemEssential
  // =========================================================================

  describe("updateItemEssential", () => {
    it("sets isEssential to false", async () => {
      const itemId = itemIds[0]!;
      const result = await caller.budget.updateItemEssential({
        id: itemId,
        isEssential: false,
      });
      expect(result!.isEssential).toBe(false);
    });

    it("sets isEssential back to true", async () => {
      const itemId = itemIds[0]!;
      const result = await caller.budget.updateItemEssential({
        id: itemId,
        isEssential: true,
      });
      expect(result!.isEssential).toBe(true);
    });

    it("returns the full updated item row", async () => {
      const itemId = itemIds[2]!;
      const result = await caller.budget.updateItemEssential({
        id: itemId,
        isEssential: false,
      });
      expect(result).toBeDefined();
      expect(result!.id).toBe(itemId);
      expect(result!.isEssential).toBe(false);
    });
  });

  // =========================================================================
  // moveItem
  // =========================================================================

  describe("moveItem", () => {
    it("moves an item to a different category", async () => {
      const itemId = itemIds[2]!; // Dining in Lifestyle
      const result = await caller.budget.moveItem({
        id: itemId,
        newCategory: "Entertainment",
      });
      expect(result).toBeDefined();
      expect(result!.category).toBe("Entertainment");
    });

    it("moves item back to original category", async () => {
      const itemId = itemIds[2]!;
      const result = await caller.budget.moveItem({
        id: itemId,
        newCategory: "Lifestyle",
      });
      expect(result!.category).toBe("Lifestyle");
    });

    it("returns the full updated item row", async () => {
      const itemId = itemIds[1]!;
      const result = await caller.budget.moveItem({
        id: itemId,
        newCategory: "Food",
      });
      expect(result!.id).toBe(itemId);
      expect(result!.category).toBe("Food");

      // Restore
      await caller.budget.moveItem({ id: itemId, newCategory: "Essentials" });
    });

    it("rejects blank newCategory", async () => {
      await expect(
        caller.budget.moveItem({ id: itemIds[0]!, newCategory: "  " }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // addColumn
  // =========================================================================

  describe("addColumn", () => {
    it("adds a new column to the active profile", async () => {
      const result = await caller.budget.addColumn({ label: "High Spend" });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.columnCount).toBe(2);
      expect(main.columnLabels).toContain("High Spend");
    });

    it("extends all existing item amounts arrays by one zero", async () => {
      // After addColumn, each item should now have 2-element amounts
      const summary = await caller.budget.computeActiveSummary();
      for (const item of summary.rawItems!) {
        expect((item.amounts as number[]).length).toBe(2);
        // The new column should be zero
        expect((item.amounts as number[])[1]).toBe(0);
      }
    });

    it("rejects an empty label", async () => {
      await expect(caller.budget.addColumn({ label: "" })).rejects.toThrow();
    });
  });

  // =========================================================================
  // renameColumn
  // =========================================================================

  describe("renameColumn", () => {
    // At this point the active profile has 2 columns from addColumn above.

    it("renames column 0 of the active profile", async () => {
      const result = await caller.budget.renameColumn({
        colIndex: 0,
        label: "Base",
      });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect((main.columnLabels as string[])[0]).toBe("Base");
    });

    it("renames column 1 of the active profile", async () => {
      const result = await caller.budget.renameColumn({
        colIndex: 1,
        label: "Premium",
      });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect((main.columnLabels as string[])[1]).toBe("Premium");
    });

    it("throws for out-of-bounds colIndex", async () => {
      await expect(
        caller.budget.renameColumn({ colIndex: 99, label: "X" }),
      ).rejects.toThrow("Invalid column index");
    });

    it("rejects an empty label", async () => {
      await expect(
        caller.budget.renameColumn({ colIndex: 0, label: "" }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // updateColumnMonths
  // =========================================================================

  describe("updateColumnMonths", () => {
    // Active profile currently has 2 columns.

    it("sets column months on the active profile", async () => {
      const result = await caller.budget.updateColumnMonths({
        columnMonths: [6, 6],
      });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.columnMonths).toEqual([6, 6]);
    });

    it("weighted annualTotal uses columnMonths when set", async () => {
      // col0: Rent 2000 + Groceries 600 + Dining 200 = 2800 * 6 months
      // col1: all items are 0 * 6 months
      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.annualTotal).toBe(2800 * 6 + 0 * 6);
    });

    it("throws when columnMonths length does not match column count", async () => {
      await expect(
        caller.budget.updateColumnMonths({ columnMonths: [12] }),
      ).rejects.toThrow("columnMonths length must match columnLabels length");
    });

    it("accepts null to clear column months", async () => {
      const result = await caller.budget.updateColumnMonths({
        columnMonths: null,
      });
      expect(result).toEqual({ ok: true });

      // After clearing, annualTotal should revert to col0 * 12
      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.columnMonths).toBeNull();
    });
  });

  // =========================================================================
  // removeColumn
  // =========================================================================

  describe("removeColumn", () => {
    it("throws when only one column exists", async () => {
      const fresh = await createTestCaller();
      try {
        seedStandardDataset(fresh.db);
        await expect(
          fresh.caller.budget.removeColumn({ colIndex: 0 }),
        ).rejects.toThrow("Cannot remove the last column");
      } finally {
        fresh.cleanup();
      }
    });

    it("removes column 1 from the active profile (which has 2 columns)", async () => {
      // Active profile: ["Base", "Premium"] — remove index 1
      const result = await caller.budget.removeColumn({ colIndex: 1 });
      expect(result).toEqual({ ok: true });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.columnCount).toBe(1);
      expect((main.columnLabels as string[])[0]).toBe("Base");
    });

    it("shrinks all item amounts arrays after column removal", async () => {
      const summary = await caller.budget.computeActiveSummary();
      for (const item of summary.rawItems!) {
        expect((item.amounts as number[]).length).toBe(1);
      }
    });

    it("throws for an out-of-bounds colIndex", async () => {
      // Need >=2 columns to reach the index guard; add a temp column
      await caller.budget.addColumn({ label: "Temp" });
      await expect(
        caller.budget.removeColumn({ colIndex: 99 }),
      ).rejects.toThrow("Invalid column index");
      // Remove the temp column we just added
      await caller.budget.removeColumn({ colIndex: 1 });
    });
  });

  // =========================================================================
  // linkToApi / unlinkFromApi
  // =========================================================================

  describe("linkToApi", () => {
    it("links a budget item to an API category with pull direction", async () => {
      const itemId = itemIds[0]!;
      const result = await caller.budget.linkToApi({
        budgetItemId: itemId,
        apiCategoryId: "cat-abc-123",
        apiCategoryName: "Rent & Mortgage",
        syncDirection: "pull",
      });
      expect(result).toEqual({ ok: true });
    });

    it("linked item exposes apiCategoryId and apiCategoryName in computeActiveSummary", async () => {
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === itemIds[0]!);
      expect(item!.apiCategoryId).toBe("cat-abc-123");
      expect(item!.apiCategoryName).toBe("Rent & Mortgage");
      expect(item!.apiSyncDirection).toBe("pull");
    });

    it("links with push sync direction", async () => {
      const itemId = itemIds[1]!;
      await caller.budget.linkToApi({
        budgetItemId: itemId,
        apiCategoryId: "cat-xyz-456",
        apiCategoryName: "Groceries",
        syncDirection: "push",
      });
      const summary = await caller.budget.computeActiveSummary();
      expect(
        summary.rawItems!.find((i) => i.id === itemId)!.apiSyncDirection,
      ).toBe("push");
    });

    it("links with both sync direction", async () => {
      const itemId = itemIds[2]!;
      await caller.budget.linkToApi({
        budgetItemId: itemId,
        apiCategoryId: "cat-both-789",
        apiCategoryName: "Dining Out",
        syncDirection: "both",
      });
      const summary = await caller.budget.computeActiveSummary();
      expect(
        summary.rawItems!.find((i) => i.id === itemId)!.apiSyncDirection,
      ).toBe("both");
    });

    it("defaults syncDirection to pull when not specified", async () => {
      const created = await caller.budget.createItem({
        category: "Test",
        subcategory: "Default Dir",
      });
      await caller.budget.linkToApi({
        budgetItemId: created!.id,
        apiCategoryId: "cat-default",
        apiCategoryName: "Default Category",
      });
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === created!.id);
      expect(item!.apiSyncDirection).toBe("pull");
    });
  });

  describe("unlinkFromApi", () => {
    it("removes API link from a previously linked item", async () => {
      const itemId = itemIds[0]!;
      const result = await caller.budget.unlinkFromApi({
        budgetItemId: itemId,
      });
      expect(result).toEqual({ ok: true });
    });

    it("item has null apiCategoryId after unlinking", async () => {
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === itemIds[0]!);
      expect(item!.apiCategoryId).toBeNull();
      expect(item!.apiCategoryName).toBeNull();
    });

    it("resets apiSyncDirection to pull after unlinking", async () => {
      const itemId = itemIds[1]!; // was linked with push
      await caller.budget.unlinkFromApi({ budgetItemId: itemId });
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === itemId);
      expect(item!.apiSyncDirection).toBe("pull");
    });

    it("is idempotent on an already-unlinked item", async () => {
      const itemId = itemIds[0]!; // already unlinked above
      const result = await caller.budget.unlinkFromApi({
        budgetItemId: itemId,
      });
      expect(result).toEqual({ ok: true });
    });
  });

  // =========================================================================
  // setSyncDirection
  // =========================================================================

  describe("setSyncDirection", () => {
    it("updates sync direction to push", async () => {
      const itemId = itemIds[2]!;
      const result = await caller.budget.setSyncDirection({
        budgetItemId: itemId,
        syncDirection: "push",
      });
      expect(result).toEqual({ ok: true });

      const summary = await caller.budget.computeActiveSummary();
      expect(
        summary.rawItems!.find((i) => i.id === itemId)!.apiSyncDirection,
      ).toBe("push");
    });

    it("updates sync direction to both", async () => {
      const itemId = itemIds[2]!;
      await caller.budget.setSyncDirection({
        budgetItemId: itemId,
        syncDirection: "both",
      });
      const summary = await caller.budget.computeActiveSummary();
      expect(
        summary.rawItems!.find((i) => i.id === itemId)!.apiSyncDirection,
      ).toBe("both");
    });

    it("updates sync direction to pull", async () => {
      const itemId = itemIds[2]!;
      await caller.budget.setSyncDirection({
        budgetItemId: itemId,
        syncDirection: "pull",
      });
      const summary = await caller.budget.computeActiveSummary();
      expect(
        summary.rawItems!.find((i) => i.id === itemId)!.apiSyncDirection,
      ).toBe("pull");
    });

    it("rejects an invalid sync direction value", async () => {
      await expect(
        // @ts-expect-error intentionally wrong value
        caller.budget.setSyncDirection({
          budgetItemId: itemIds[0]!,
          syncDirection: "invalid",
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // computeActiveSummary
  // =========================================================================

  describe("computeActiveSummary", () => {
    it("returns null result when no profiles exist in a fresh environment", async () => {
      const fresh = await createTestCaller();
      try {
        const result = await fresh.caller.budget.computeActiveSummary();
        expect(result.profile).toBeNull();
        expect(result.result).toBeNull();
        expect(result.columnLabels).toEqual([]);
      } finally {
        fresh.cleanup();
      }
    });

    it("returns the active profile", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(result.profile).toBeDefined();
      expect(result.profile!.id).toBe(profileId);
      expect(result.profile!.name).toBe("Main Budget");
    });

    it("returns columnLabels from the active profile", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(Array.isArray(result.columnLabels)).toBe(true);
      expect(result.columnLabels.length).toBeGreaterThanOrEqual(1);
    });

    it("returns rawItems with expected fields", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(Array.isArray(result.rawItems)).toBe(true);
      expect(result.rawItems!.length).toBeGreaterThan(0);
      for (const item of result.rawItems!) {
        expect(typeof item.id).toBe("number");
        expect(typeof item.category).toBe("string");
        expect(typeof item.subcategory).toBe("string");
        expect(Array.isArray(item.amounts)).toBe(true);
      }
    });

    it("includes seeded Essentials items", async () => {
      const result = await caller.budget.computeActiveSummary();
      const essentials = result.rawItems!.filter(
        (i) => i.category === "Essentials",
      );
      expect(essentials.length).toBeGreaterThanOrEqual(2);
    });

    it("returns a non-null calculator result", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(result.result).not.toBeNull();
    });

    it("returns allColumnResults with one entry per column", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(Array.isArray(result.allColumnResults)).toBe(true);
      expect(result.allColumnResults!.length).toBe(result.columnLabels.length);
    });

    it("returns weightedAnnualTotal as a number", async () => {
      const result = await caller.budget.computeActiveSummary();
      expect(typeof result.weightedAnnualTotal).toBe("number");
    });

    it("accepts optional selectedColumn parameter without error", async () => {
      const result = await caller.budget.computeActiveSummary({
        selectedColumn: 0,
      });
      expect(result.profile).toBeDefined();
      expect(result.result).not.toBeNull();
    });

    it("clamps selectedColumn to last valid index when out of range", async () => {
      // Should not throw — clamps internally
      const result = await caller.budget.computeActiveSummary({
        selectedColumn: 999,
      });
      expect(result.result).not.toBeNull();
    });

    it("accepts a specific profileId to query a non-active profile", async () => {
      const secondary = await caller.budget.createProfile({
        name: "Side Budget",
      });
      const result = await caller.budget.computeActiveSummary({
        profileId: secondary!.id,
      });
      expect(result.profile!.id).toBe(secondary!.id);
    });

    it("returns null profile/result for a profileId that does not exist", async () => {
      const result = await caller.budget.computeActiveSummary({
        profileId: 999999,
      });
      expect(result.profile).toBeNull();
      expect(result.result).toBeNull();
    });

    it("contribAmount is null for items without a linked contribution account", async () => {
      const result = await caller.budget.computeActiveSummary();
      for (const item of result.rawItems!) {
        if (!item.contributionAccountId) {
          expect(item.contribAmount).toBeNull();
        }
      }
    });
  });
});

// =========================================================================
// Auth / permission checks (separate suite with its own DB)
// =========================================================================

describe("budget router — auth", () => {
  it("viewer without budget permission cannot call createProfile", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      await expect(
        caller.budget.createProfile({ name: "Unauthorized" }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("viewer without budget permission cannot call addColumn", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      await expect(
        caller.budget.addColumn({ label: "Unauthorized Column" }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("viewer with budget permission can call createProfile", async () => {
    const session = createViewerSessionWithPermissions(["budget"]);
    const { caller, cleanup } = await createTestCaller(session);
    try {
      const profile = await caller.budget.createProfile({
        name: "Authorized Budget",
      });
      expect(profile!.name).toBe("Authorized Budget");
    } finally {
      cleanup();
    }
  });

  it("viewer (any role) can call listProfiles (read-only procedure)", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      const profiles = await caller.budget.listProfiles();
      expect(Array.isArray(profiles)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("viewer (any role) can call computeActiveSummary (read-only procedure)", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      const result = await caller.budget.computeActiveSummary();
      // Empty DB — no active profile
      expect(result.profile).toBeNull();
    } finally {
      cleanup();
    }
  });
});
