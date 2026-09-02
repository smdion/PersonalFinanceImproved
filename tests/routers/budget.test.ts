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
import { eq, asc } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedStandardDataset,
  seedBudgetItem,
  seedBudgetProfile,
  seedPerson,
  seedJob,
  seedContributionProfile,
  viewerSession,
  createViewerSessionWithPermissions,
} from "./setup";

/** Seed a jobless (budget-linkable) contribution account with correct schema field names. */
function seedLinkableContributionAccount(
  db: Awaited<ReturnType<typeof createTestCaller>>["db"],
  personId: number,
  overrides: Partial<
    typeof sqliteSchema.contributionAccounts.$inferInsert
  > = {},
): number {
  // Accounts carry no value of their own — contributionMethod/Value are
  // stripped here and given to the account via a Contribution Profile's
  // active fields instead (see seedLinkableContributionAccountWithProfile).
  const { contributionMethod: _m, contributionValue: _v, ...rest } = overrides;
  const result = db
    .insert(sqliteSchema.contributionAccounts)
    .values({
      personId,
      jobId: null,
      accountType: "brokerage",
      parentCategory: "Portfolio",
      taxTreatment: "after_tax",
      employerMatchType: "none",
      isActive: true,
      ...rest,
    })
    .returning({ id: sqliteSchema.contributionAccounts.id })
    .get();
  return result.id;
}

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("ynab"),
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
      // seeded items: Rent 2000 + Groceries 600 + Dining 200 = 2800/month,
      // plus seedStandardDataset's default goal at $500/mo savings — annualTotal
      // is spending + savings, not budget items alone.
      const result = await caller.budget.listProfiles();
      const main = result.find((p) => p.id === profileId)!;
      expect(main.annualTotal).toBe((2800 + 500) * 12);
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
  // reorderCategory / reorderItem
  // =========================================================================

  describe("reorderCategory / reorderItem", () => {
    // Isolated profile + explicitly-ordered items — the shared fixture's
    // items all default to sortOrder 0, which leaves tie-break order
    // unspecified and unsuitable for asserting exact positions.
    let reorderProfileId: number;
    let a1: number, a2: number, b1: number, c1: number, c2: number, c3: number;

    beforeAll(async () => {
      reorderProfileId = await seedBudgetProfile(db, "Reorder Test", false);
      a1 = seedBudgetItem(db, reorderProfileId, {
        category: "A",
        subcategory: "A1",
        amounts: [100],
        sortOrder: 0,
      });
      a2 = seedBudgetItem(db, reorderProfileId, {
        category: "A",
        subcategory: "A2",
        amounts: [100],
        sortOrder: 1,
      });
      b1 = seedBudgetItem(db, reorderProfileId, {
        category: "B",
        subcategory: "B1",
        amounts: [100],
        sortOrder: 2,
      });
      c1 = seedBudgetItem(db, reorderProfileId, {
        category: "C",
        subcategory: "C1",
        amounts: [100],
        sortOrder: 3,
      });
      c2 = seedBudgetItem(db, reorderProfileId, {
        category: "C",
        subcategory: "C2",
        amounts: [100],
        sortOrder: 4,
      });
      c3 = seedBudgetItem(db, reorderProfileId, {
        category: "C",
        subcategory: "C3",
        amounts: [100],
        sortOrder: 5,
      });
    });

    function getOrdered() {
      return db
        .select()
        .from(sqliteSchema.budgetItems)
        .where(eq(sqliteSchema.budgetItems.profileId, reorderProfileId))
        .orderBy(asc(sqliteSchema.budgetItems.sortOrder))
        .all();
    }

    it("orderBy sort_order reflects the seeded A, B, C order initially", () => {
      const rows = getOrdered();
      expect(rows.map((r) => r.category)).toEqual([
        "A",
        "A",
        "B",
        "C",
        "C",
        "C",
      ]);
      expect(rows.map((r) => r.id)).toEqual([a1, a2, b1, c1, c2, c3]);
    });

    it("reorderCategory no-ops when the first category tries to move up", async () => {
      const before = getOrdered().map((r) => r.id);
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "A",
        direction: "up",
      });
      expect(getOrdered().map((r) => r.id)).toEqual(before);
    });

    it("reorderCategory no-ops when the last category tries to move down", async () => {
      const before = getOrdered().map((r) => r.id);
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "C",
        direction: "down",
      });
      expect(getOrdered().map((r) => r.id)).toEqual(before);
    });

    it("reorderCategory swaps the whole block with the adjacent category, preserving internal item order", async () => {
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "B",
        direction: "up",
      });
      const rows = getOrdered();
      // B (1 item) swapped above A (2 items): B, A, A, C, C, C
      expect(rows.map((r) => r.category)).toEqual([
        "B",
        "A",
        "A",
        "C",
        "C",
        "C",
      ]);
      expect(rows.map((r) => r.id)).toEqual([b1, a1, a2, c1, c2, c3]);
      // Restore
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "B",
        direction: "down",
      });
      expect(getOrdered().map((r) => r.id)).toEqual([a1, a2, b1, c1, c2, c3]);
    });

    it("reorderCategory renumbers sort_order as a clean gapless 0..N-1 sequence", async () => {
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "B",
        direction: "up",
      });
      const rows = getOrdered();
      expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
      // Restore
      await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "B",
        direction: "down",
      });
    });

    it("reorderCategory is a no-op (still ok) for an unknown category name", async () => {
      const before = getOrdered().map((r) => r.id);
      const result = await caller.budget.reorderCategory({
        profileId: reorderProfileId,
        category: "Nonexistent",
        direction: "up",
      });
      expect(result).toEqual({ ok: true });
      expect(getOrdered().map((r) => r.id)).toEqual(before);
    });

    it("reorderItem no-ops for the first item in its category (does not cross into the previous category)", async () => {
      const before = getOrdered().map((r) => r.id);
      await caller.budget.reorderItem({ id: a1, direction: "up" });
      expect(getOrdered().map((r) => r.id)).toEqual(before);
    });

    it("reorderItem no-ops for the last item in its category (does not cross into the next category)", async () => {
      // a2 is the last item in category A, but NOT the last item overall
      // (B follows) — must not bleed into B.
      const before = getOrdered().map((r) => r.id);
      await caller.budget.reorderItem({ id: a2, direction: "down" });
      expect(getOrdered().map((r) => r.id)).toEqual(before);
    });

    it("reorderItem swaps with the adjacent item within the same category", async () => {
      await caller.budget.reorderItem({ id: a1, direction: "down" });
      const rows = getOrdered();
      expect(rows.map((r) => r.id)).toEqual([a2, a1, b1, c1, c2, c3]);
      // Restore
      await caller.budget.reorderItem({ id: a1, direction: "up" });
      expect(getOrdered().map((r) => r.id)).toEqual([a1, a2, b1, c1, c2, c3]);
    });

    it("reorderItem on a middle item of a 3-item category only swaps with its neighbor", async () => {
      await caller.budget.reorderItem({ id: c2, direction: "up" });
      const rows = getOrdered();
      expect(rows.map((r) => r.id)).toEqual([a1, a2, b1, c2, c1, c3]);
      // Restore
      await caller.budget.reorderItem({ id: c2, direction: "down" });
      expect(getOrdered().map((r) => r.id)).toEqual([a1, a2, b1, c1, c2, c3]);
    });

    it("reorderItem throws for an unknown item id", async () => {
      await expect(
        caller.budget.reorderItem({ id: 9_999_999, direction: "up" }),
      ).rejects.toThrow("Item not found");
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
      // plus seedStandardDataset's default goal at $500/mo savings * 12
      // (savings funding doesn't vary by mode, so it's not weighted by column).
      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.id === profileId)!;
      expect(main.annualTotal).toBe(2800 * 6 + 0 * 6 + 500 * 12);
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
      await caller.budget.unlinkFromApi({
        budgetItemId: itemId,
        service: "ynab",
      });
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === itemId);
      expect(item!.apiSyncDirection).toBe("pull");
    });

    it("is idempotent on an already-unlinked item", async () => {
      const itemId = itemIds[0]!; // already unlinked above
      const result = await caller.budget.unlinkFromApi({
        budgetItemId: itemId,
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
          service: "ynab",
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

    it("budgetIncomeAdjustmentThisMonth sums the current real month only, identically across selectedColumn", async () => {
      const fresh = await createTestCaller();
      try {
        seedStandardDataset(fresh.db);
        const personId = await seedPerson(fresh.db, "Adj Tester");
        const jobId = seedJob(fresh.db, personId);
        const jobId2 = seedJob(fresh.db, personId);
        // Give the profile a second column so selectedColumn 0 vs 1 is a
        // real distinction, not a no-op clamp.
        const prof = await fresh.caller.budget.listProfiles();
        const activeProf = prof.find((p) => p.isActive)!;
        await fresh.caller.budget.addColumn({
          profileId: activeProf.id,
          label: "Tight",
        });

        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const nextMonth = `${now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()}-${String(now.getMonth() === 11 ? 1 : now.getMonth() + 2).padStart(2, "0")}-01`;
        fresh.db
          .insert(sqliteSchema.budgetIncomeAdjustments)
          .values([
            { jobId, monthDate: thisMonth, amount: "500.00", source: "rule" },
            {
              jobId: jobId2,
              monthDate: thisMonth,
              amount: "250.00",
              source: "rule",
            },
            // A different month must be excluded from the sum.
            { jobId, monthDate: nextMonth, amount: "999.00", source: "rule" },
          ])
          .run();

        const col0 = await fresh.caller.budget.computeActiveSummary({
          selectedColumn: 0,
        });
        const col1 = await fresh.caller.budget.computeActiveSummary({
          selectedColumn: 1,
        });

        expect(col0.budgetIncomeAdjustmentThisMonth).toBe(750);
        // The invariant the advisor required: this figure is a pure
        // function of the real current month, never varies with the
        // scenario column the caller asked for.
        expect(col1.budgetIncomeAdjustmentThisMonth).toBe(
          col0.budgetIncomeAdjustmentThisMonth,
        );
      } finally {
        fresh.cleanup();
      }
    });
  });

  // =========================================================================
  // Linked-item amount edits write through to contribution_accounts
  // =========================================================================

  describe("amount edits on contribution-linked items", () => {
    let linkedItemCounter = 0;

    /**
     * Seeds a linked contribution account + budget item, plus a Contribution
     * Profile giving the account its starting value (accounts carry no
     * value of their own anymore). Returns the profile's id so tests can
     * pass it through as `contributionProfile.globalDefaultId`.
     */
    async function seedLinkedItem(
      overrides: {
        contributionMethod: string;
        contributionValue: string;
      } & Partial<typeof sqliteSchema.contributionAccounts.$inferInsert>,
    ) {
      linkedItemCounter += 1;
      const { contributionMethod, contributionValue, ...rest } = overrides;
      const personId = await seedPerson(db);
      const contribAccountId = seedLinkableContributionAccount(
        db,
        personId,
        rest,
      );
      const contribProfileId = seedContributionProfile(db, {
        name: `Linked Item Profile ${linkedItemCounter}`,
        contributionActiveFields: {
          contributionAccounts: {
            [String(contribAccountId)]: {
              contributionValue,
              contributionMethod,
            },
          },
          jobs: {},
        },
      });
      const itemId = seedBudgetItem(db, profileId, {
        category: "Investing",
        subcategory: `LT Brokerage Test ${linkedItemCounter}`,
        amounts: [999], // should never be read once linked
        contributionAccountId: contribAccountId,
      });
      return { contribAccountId, itemId, contribProfileId };
    }

    /** contributionProfile tiers pointing at the given profile as the
     * globally-active default — the precedence tier updateItemAmount(s)
     * resolves against when the test doesn't pin one more specifically. */
    function profileTiers(contribProfileId: number) {
      return {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: contribProfileId,
      };
    }

    function getContributionValue(contribProfileId: number): number {
      const row = db
        .select()
        .from(sqliteSchema.contributionProfiles)
        .where(eq(sqliteSchema.contributionProfiles.id, contribProfileId))
        .get()!;
      const activeFields = row.contributionActiveFields as {
        contributionAccounts: Record<string, { contributionValue: string }>;
      };
      const entry = Object.values(activeFields.contributionAccounts)[0]!;
      return Number(entry.contributionValue);
    }

    function getBudgetItemAmounts(itemId: number): number[] {
      const row = db
        .select()
        .from(sqliteSchema.budgetItems)
        .where(eq(sqliteSchema.budgetItems.id, itemId))
        .get()!;
      return row.amounts as number[];
    }

    it("updateItemAmount writes through to the Contribution Profile's active value, not budget_items.amounts (fixed_monthly)", async () => {
      const { itemId, contribProfileId } = await seedLinkedItem({
        contributionMethod: "fixed_monthly",
        contributionValue: "75.00",
      });

      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 100,
        contributionProfile: profileTiers(contribProfileId),
      });

      expect(getContributionValue(contribProfileId)).toBeCloseTo(100);
      expect(getBudgetItemAmounts(itemId)[0]).toBe(999); // untouched
    });

    it("updateItemAmounts (batch) writes through to the Contribution Profile for linked items and amounts for unlinked items", async () => {
      const { itemId: linkedItemId, contribProfileId } = await seedLinkedItem({
        contributionMethod: "fixed_monthly",
        contributionValue: "75.00",
      });
      const unlinkedItemId = seedBudgetItem(db, profileId, {
        category: "Essentials",
        subcategory: "Batch Test Unlinked",
        amounts: [50],
      });

      await caller.budget.updateItemAmounts({
        updates: [
          { id: linkedItemId, colIndex: 0, amount: 120 },
          { id: unlinkedItemId, colIndex: 0, amount: 80 },
        ],
        contributionProfile: profileTiers(contribProfileId),
      });

      expect(getContributionValue(contribProfileId)).toBeCloseTo(120);
      expect(getBudgetItemAmounts(linkedItemId)[0]).toBe(999); // untouched
      expect(getBudgetItemAmounts(unlinkedItemId)[0]).toBe(80);
    });

    it("fixed_annual round-trips: editing to the currently-displayed monthly value is a no-op", async () => {
      const { itemId, contribProfileId } = await seedLinkedItem({
        contributionMethod: "fixed_annual",
        contributionValue: "1000.00", // monthly = 1000/12 = 83.333... -> displayed as 83.33
      });

      const before = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
      });
      const linked = before.rawItems!.find((i) => i.id === itemId)!;
      expect(linked.contribAmount).toBeCloseTo(83.33, 2);

      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: linked.contribAmount!,
        contributionProfile: profileTiers(contribProfileId),
      });

      // Should not drift (e.g. to 999.96) from re-saving the displayed value.
      expect(getContributionValue(contribProfileId)).toBeCloseTo(1000, 2);
    });

    it("fixed_per_period converts correctly", async () => {
      // No jobs seeded in this suite's dataset besides the one from
      // seedStandardDataset (biweekly, 26 periods/year).
      const { itemId, contribProfileId } = await seedLinkedItem({
        contributionMethod: "fixed_per_period",
        contributionValue: "50.00", // monthly = 50*26/12 = 108.33
      });

      const before = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
      });
      const linked = before.rawItems!.find((i) => i.id === itemId)!;
      expect(linked.contribAmount).toBeCloseTo((50 * 26) / 12, 2);

      await caller.budget.updateItemAmount({
        id: itemId,
        colIndex: 0,
        amount: 200, // new monthly target
        contributionProfile: profileTiers(contribProfileId),
      });

      // value = 200 * 12 / 26
      expect(getContributionValue(contribProfileId)).toBeCloseTo(
        (200 * 12) / 26,
        2,
      );
    });

    it("rejects editing a percent_of_salary-linked item with a clear error", async () => {
      const { itemId, contribProfileId } = await seedLinkedItem({
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
      });

      await expect(
        caller.budget.updateItemAmount({
          id: itemId,
          colIndex: 0,
          amount: 100,
          contributionProfile: profileTiers(contribProfileId),
        }),
      ).rejects.toThrow(/percent_of_salary/);
    });

    // -----------------------------------------------------------------------
    // What-If sandbox overrides on a linked item — the exact behavior
    // resolveLinkedBudgetItemAmounts's consolidation (Ledgr v0.7.6 review)
    // must preserve: computeActiveSummary previously resolved this through a
    // hand-rolled duplicate of the shared helper specifically so sandbox
    // edits could apply; after consolidation the shared helper itself must
    // apply them.
    // -----------------------------------------------------------------------

    it("sandboxContribActiveFields overrides a linked item's amount, on top of the Contribution Profile's own value", async () => {
      const { itemId, contribAccountId, contribProfileId } =
        await seedLinkedItem({
          contributionMethod: "fixed_monthly",
          contributionValue: "75.00",
        });

      const baseline = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
      });
      expect(
        baseline.rawItems!.find((i) => i.id === itemId)!.contribAmount,
      ).toBeCloseTo(75, 2);

      const withSandbox = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
        sandboxContribActiveFields: {
          [String(contribAccountId)]: { contributionValue: "300" },
        },
      });
      const sandboxed = withSandbox.rawItems!.find((i) => i.id === itemId)!;
      expect(sandboxed.contribAmount).toBeCloseTo(300, 2);
      expect(sandboxed.contribAmounts![0]).toBeCloseTo(300, 2);

      // The sandbox is request-scoped — it must never write through to the
      // Contribution Profile's real stored value.
      expect(getContributionValue(contribProfileId)).toBeCloseTo(75, 2);
    });

    it("sandboxSalaryEntries doesn't change a fixed_per_period linked item's amount (salary-independent), unlike percent_of_salary", async () => {
      // fixed_per_period's amount depends on the job's pay period, not
      // salary — this asserts sandboxSalaryEntries's job-periods resolution
      // path (also newly consolidated onto the shared helper) still leaves
      // a salary-independent method's amount alone.
      const personId = await seedPerson(db);
      const jobId = seedJob(db, personId);
      const contribAccountId = seedLinkableContributionAccount(db, personId, {
        jobId,
      });
      const contribProfileId = seedContributionProfile(db, {
        name: "Sandbox Salary Test Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contribAccountId)]: {
              contributionValue: "50",
              contributionMethod: "fixed_per_period",
            },
          },
        },
      });
      const itemId = seedBudgetItem(db, profileId, {
        category: "Investing",
        subcategory: "Sandbox Salary Test Item",
        amounts: [999],
        contributionAccountId: contribAccountId,
      });

      const baseline = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
      });
      const before = baseline.rawItems!.find((i) => i.id === itemId)!;
      expect(before.contribAmount).toBeCloseTo((50 * 26) / 12, 2);

      const withSandbox = await caller.budget.computeActiveSummary({
        contributionProfile: profileTiers(contribProfileId),
        sandboxSalaryEntries: {
          [String(personId)]: { salary: 999999 },
        },
      });
      const after = withSandbox.rawItems!.find((i) => i.id === itemId)!;

      expect(after.contribAmount).toBeCloseTo(before.contribAmount!, 2);
    });
  });

  // -------------------------------------------------------------------------
  // contribStatus — why a linked item's amount is $0 for a given column,
  // distinguishing genuinely-zero from causes the "PC" badge used to be
  // unable to tell apart (classifyContribResolution).
  // -------------------------------------------------------------------------

  describe("contribStatus on linked items", () => {
    it("returns not_in_profile when the resolved profile has no entry for the account", async () => {
      const personId = await seedPerson(db);
      const contribAccountId = seedLinkableContributionAccount(db, personId);
      const emptyProfileId = seedContributionProfile(db, {
        name: "Empty Profile For Status Test",
        contributionActiveFields: { contributionAccounts: {} },
      });
      const itemId = seedBudgetItem(db, profileId, {
        category: "Investing",
        subcategory: "Status Test Not In Profile",
        amounts: [999],
        contributionAccountId: contribAccountId,
      });

      const result = await caller.budget.computeActiveSummary({
        contributionProfile: {
          planPinId: null,
          localSelectionId: null,
          globalDefaultId: emptyProfileId,
        },
      });
      const item = result.rawItems!.find((i) => i.id === itemId)!;
      expect(item.contribAmount).toBe(0);
      expect(item.contribStatus).toEqual(["not_in_profile"]);
    });

    it("returns inactive_in_profile when the profile's entry explicitly turns the account off", async () => {
      const personId = await seedPerson(db);
      const contribAccountId = seedLinkableContributionAccount(db, personId);
      const offProfileId = seedContributionProfile(db, {
        name: "Off Profile For Status Test",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contribAccountId)]: {
              contributionValue: "100",
              contributionMethod: "fixed_monthly",
              isActive: false,
            },
          },
        },
      });
      const itemId = seedBudgetItem(db, profileId, {
        category: "Investing",
        subcategory: "Status Test Inactive In Profile",
        amounts: [999],
        contributionAccountId: contribAccountId,
      });

      const result = await caller.budget.computeActiveSummary({
        contributionProfile: {
          planPinId: null,
          localSelectionId: null,
          globalDefaultId: offProfileId,
        },
      });
      const item = result.rawItems!.find((i) => i.id === itemId)!;
      expect(item.contribAmount).toBe(0);
      expect(item.contribStatus).toEqual(["inactive_in_profile"]);
    });

    // "inactive_in_sandbox" is exercised directly against
    // classifyContribResolution (tests/helpers/contribution-extended.test.ts)
    // rather than end-to-end here: zSandboxContribActiveFields
    // (server/routers/_shared.ts) only accepts { contributionValue }, so
    // isActive is stripped before it ever reaches the resolver — a What-If
    // override can change an account's value but cannot disable one today.
    // The classifier still models what applyContribActiveFields's overlay
    // layer supports in general, in case that schema is ever widened.

    it("returns account_unavailable when the linked account is globally deactivated", async () => {
      const personId = await seedPerson(db);
      const contribAccountId = seedLinkableContributionAccount(db, personId, {
        isActive: false,
      });
      const someProfileId = seedContributionProfile(db, {
        name: "Deactivated Account Status Test",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contribAccountId)]: {
              contributionValue: "100",
              contributionMethod: "fixed_monthly",
            },
          },
        },
      });
      const itemId = seedBudgetItem(db, profileId, {
        category: "Investing",
        subcategory: "Status Test Account Unavailable",
        amounts: [999],
        contributionAccountId: contribAccountId,
      });

      const result = await caller.budget.computeActiveSummary({
        contributionProfile: {
          planPinId: null,
          localSelectionId: null,
          globalDefaultId: someProfileId,
        },
      });
      const item = result.rawItems!.find((i) => i.id === itemId)!;
      expect(item.contribAmount).toBe(0);
      expect(item.contribStatus).toEqual(["account_unavailable"]);
    });

    it("is per-column, not flattened across columns", async () => {
      const personId = await seedPerson(db);
      const contribAccountId = seedLinkableContributionAccount(db, personId);
      const profileA = seedContributionProfile(db, {
        name: "Two-Column Status Test — Profile A",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contribAccountId)]: {
              contributionValue: "100",
              contributionMethod: "fixed_monthly",
            },
          },
        },
      });
      const profileB = seedContributionProfile(db, {
        name: "Two-Column Status Test — Profile B",
        contributionActiveFields: { contributionAccounts: {} },
      });

      const twoColProfileId = await seedBudgetProfile(
        db,
        "Two Column Status Test Budget",
        false,
      );
      db.update(sqliteSchema.budgetProfiles)
        .set({
          columnLabels: ["Col A", "Col B"],
          columnContributionProfileIds: [profileA, profileB],
        })
        .where(eq(sqliteSchema.budgetProfiles.id, twoColProfileId))
        .run();
      const itemId = seedBudgetItem(db, twoColProfileId, {
        category: "Investing",
        subcategory: "Two Column Status Test Item",
        amounts: [999, 999],
        contributionAccountId: contribAccountId,
      });

      const result = await caller.budget.computeActiveSummary({
        profileId: twoColProfileId,
      });
      const item = result.rawItems!.find((i) => i.id === itemId)!;
      expect(item.contribStatus).toEqual(["ok", "not_in_profile"]);
      expect(item.contribAmounts).toEqual([100, 0]);
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
