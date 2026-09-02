/**
 * Category-links helper tests — the fix for the real production bug where a
 * budget item or savings goal could hold only ONE budget-API category link
 * at a time (the old single-slot apiCategoryId/... columns), so linking to
 * a second service silently clobbered the first (found live, 2026-08-31).
 *
 * Core assertion across these tests: setting a YNAB link and an Actual link
 * on the SAME item/goal must not clobber each other — that's the whole
 * point of the budget_item_category_links / savings_goal_category_links
 * tables replacing the old columns.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  loadBudgetItemLinks,
  setBudgetItemLink,
  deleteBudgetItemLink,
  loadSavingsGoalLinks,
  setSavingsGoalLink,
  deleteSavingsGoalLink,
  copySavingsGoalLinks,
} from "@/server/helpers/category-links";
import { createTestDb, type TestDbContext } from "./db-harness";

describe("category-links helpers", () => {
  let ctx: TestDbContext;
  let profileId: number;

  beforeAll(async () => {
    ctx = await createTestDb();
    const [profile] = ctx.db
      .insert(ctx.schema.budgetProfiles)
      .values({ name: "Test Profile", columnLabels: ["Base"] })
      .returning()
      .all();
    profileId = profile!.id;
  });

  afterAll(() => ctx.cleanup());

  function makeBudgetItem(subcategory: string) {
    const [item] = ctx.db
      .insert(ctx.schema.budgetItems)
      .values({
        profileId,
        category: "Test Category",
        subcategory,
        amounts: [0],
      })
      .returning()
      .all();
    return item!.id;
  }

  function makeSavingsGoal(name: string) {
    const [goal] = ctx.db
      .insert(ctx.schema.savingsGoals)
      .values({ name })
      .returning()
      .all();
    return goal!.id;
  }

  describe("budget item links", () => {
    it("round-trips set → load → delete", async () => {
      const itemId = makeBudgetItem("Groceries");

      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
        categoryId: "ynab-cat-1",
        categoryName: "Groceries",
        syncDirection: "pull",
      });

      const loaded = await loadBudgetItemLinks(ctx.rawDb, [itemId], "ynab");
      expect(loaded.get(itemId)).toMatchObject({
        categoryId: "ynab-cat-1",
        categoryName: "Groceries",
        syncDirection: "pull",
      });

      await deleteBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
      });
      const afterDelete = await loadBudgetItemLinks(
        ctx.rawDb,
        [itemId],
        "ynab",
      );
      expect(afterDelete.has(itemId)).toBe(false);
    });

    it("keeps YNAB and Actual links on the SAME item isolated — the core fix", async () => {
      const itemId = makeBudgetItem("Utilities");

      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
        categoryId: "ynab-cat-utilities",
        categoryName: "Utilities (YNAB)",
      });
      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "actual",
        categoryId: "actual-cat-utilities",
        categoryName: "Utilities (Actual)",
      });

      const ynabLinks = await loadBudgetItemLinks(ctx.rawDb, [itemId], "ynab");
      const actualLinks = await loadBudgetItemLinks(
        ctx.rawDb,
        [itemId],
        "actual",
      );

      // The bug this fixes: linking to Actual must NOT have clobbered the
      // YNAB link that was already there.
      expect(ynabLinks.get(itemId)?.categoryId).toBe("ynab-cat-utilities");
      expect(actualLinks.get(itemId)?.categoryId).toBe("actual-cat-utilities");

      // Deleting one service's link must not touch the other's.
      await deleteBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
      });
      const ynabAfter = await loadBudgetItemLinks(ctx.rawDb, [itemId], "ynab");
      const actualAfter = await loadBudgetItemLinks(
        ctx.rawDb,
        [itemId],
        "actual",
      );
      expect(ynabAfter.has(itemId)).toBe(false);
      expect(actualAfter.get(itemId)?.categoryId).toBe("actual-cat-utilities");
    });

    it("setBudgetItemLink upserts (re-linking the same service updates in place)", async () => {
      const itemId = makeBudgetItem("Rent");
      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
        categoryId: "cat-a",
      });
      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
        categoryId: "cat-b",
        categoryName: "Rent renamed",
      });
      const loaded = await loadBudgetItemLinks(ctx.rawDb, [itemId], "ynab");
      expect(loaded.get(itemId)).toMatchObject({
        categoryId: "cat-b",
        categoryName: "Rent renamed",
      });
    });

    it("batch-loads links for multiple items in one query", async () => {
      const item1 = makeBudgetItem("Item A");
      const item2 = makeBudgetItem("Item B");
      const item3 = makeBudgetItem("Item C");
      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: item1,
        service: "ynab",
        categoryId: "cat-1",
      });
      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: item2,
        service: "ynab",
        categoryId: "cat-2",
      });
      // item3 intentionally left unlinked

      const loaded = await loadBudgetItemLinks(
        ctx.rawDb,
        [item1, item2, item3],
        "ynab",
      );
      expect(loaded.size).toBe(2);
      expect(loaded.get(item1)?.categoryId).toBe("cat-1");
      expect(loaded.get(item2)?.categoryId).toBe("cat-2");
      expect(loaded.has(item3)).toBe(false);
    });

    it("returns an empty map for an empty id list without querying", async () => {
      const loaded = await loadBudgetItemLinks(ctx.rawDb, [], "ynab");
      expect(loaded.size).toBe(0);
    });
  });

  describe("savings goal links", () => {
    it("round-trips set → load → delete for the primary role", async () => {
      const goalId = makeSavingsGoal("Emergency Fund A");

      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
        categoryId: "ynab-efund",
        categoryName: "Emergency Fund",
      });

      const loaded = await loadSavingsGoalLinks(ctx.rawDb, [goalId], "ynab");
      expect(loaded.get(goalId)).toMatchObject({
        categoryId: "ynab-efund",
        categoryName: "Emergency Fund",
      });

      await deleteSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
      });
      const afterDelete = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
      );
      expect(afterDelete.has(goalId)).toBe(false);
    });

    it("keeps YNAB and Actual links on the SAME goal isolated — the core fix", async () => {
      const goalId = makeSavingsGoal("Vacation Fund");

      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
        categoryId: "ynab-vacation",
      });
      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "actual",
        categoryId: "actual-vacation",
      });

      const ynabLinks = await loadSavingsGoalLinks(ctx.rawDb, [goalId], "ynab");
      const actualLinks = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "actual",
      );
      expect(ynabLinks.get(goalId)?.categoryId).toBe("ynab-vacation");
      expect(actualLinks.get(goalId)?.categoryId).toBe("actual-vacation");
    });

    it("keeps primary and reimbursement roles isolated for the same (goal, service)", async () => {
      const goalId = makeSavingsGoal("Emergency Fund B");

      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
        role: "primary",
        categoryId: "ynab-efund-primary",
      });
      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
        role: "reimbursement",
        categoryId: "ynab-efund-reimbursement",
      });

      const primary = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "primary",
      );
      const reimbursement = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "reimbursement",
      );
      expect(primary.get(goalId)?.categoryId).toBe("ynab-efund-primary");
      expect(reimbursement.get(goalId)?.categoryId).toBe(
        "ynab-efund-reimbursement",
      );

      // Deleting the reimbursement role must not touch the primary link.
      await deleteSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goalId,
        service: "ynab",
        role: "reimbursement",
      });
      const primaryAfter = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "primary",
      );
      const reimbursementAfter = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "reimbursement",
      );
      expect(primaryAfter.get(goalId)?.categoryId).toBe("ynab-efund-primary");
      expect(reimbursementAfter.has(goalId)).toBe(false);
    });

    it("batch-loads links for multiple goals in one query", async () => {
      const goal1 = makeSavingsGoal("Goal One");
      const goal2 = makeSavingsGoal("Goal Two");
      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goal1,
        service: "ynab",
        categoryId: "cat-1",
      });
      await setSavingsGoalLink(ctx.rawDb, {
        savingsGoalId: goal2,
        service: "ynab",
        categoryId: "cat-2",
      });

      const loaded = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goal1, goal2],
        "ynab",
      );
      expect(loaded.size).toBe(2);
    });
  });

  describe("copySavingsGoalLinks", () => {
    it("copies a budget item's primary link to a new goal as its primary link", async () => {
      const itemId = makeBudgetItem("Sinking Fund Source");
      const goalId = makeSavingsGoal("Converted Goal");

      await setBudgetItemLink(ctx.rawDb, {
        budgetItemId: itemId,
        service: "ynab",
        categoryId: "ynab-sinking-fund",
        categoryName: "Sinking Fund",
      });

      await copySavingsGoalLinks(ctx.rawDb, {
        fromBudgetItemId: itemId,
        toSavingsGoalId: goalId,
        service: "ynab",
      });

      const goalLinks = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "primary",
      );
      expect(goalLinks.get(goalId)).toMatchObject({
        categoryId: "ynab-sinking-fund",
        categoryName: "Sinking Fund",
      });
    });

    it("is a no-op when the source item has no link for that service", async () => {
      const itemId = makeBudgetItem("Unlinked Source");
      const goalId = makeSavingsGoal("Should Stay Unlinked");

      await copySavingsGoalLinks(ctx.rawDb, {
        fromBudgetItemId: itemId,
        toSavingsGoalId: goalId,
        service: "ynab",
      });

      const goalLinks = await loadSavingsGoalLinks(
        ctx.rawDb,
        [goalId],
        "ynab",
        "primary",
      );
      expect(goalLinks.has(goalId)).toBe(false);
    });
  });
});
