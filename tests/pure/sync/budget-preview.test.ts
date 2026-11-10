/**
 * sync.getPreview's comparisons (lib/pure/sync/budget-preview.ts), on an
 * invented household's cached budget. The procedure's responses for YNAB and
 * Actual are pinned in tests/baseline/__sync__.
 */
import { describe, expect, it } from "vitest";
import type {
  BudgetAccount,
  BudgetCategoryGroup,
} from "@/lib/budget-api/types";
import {
  matchBudgetItems,
  matchSavingsGoals,
  previewApiCategories,
  previewAssetAccounts,
  previewCash,
} from "@/lib/pure/sync/budget-preview";

const account = (
  id: string,
  type: BudgetAccount["type"],
  balance: number,
  extra: Partial<BudgetAccount> = {},
): BudgetAccount => ({
  id,
  name: id,
  type,
  onBudget: true,
  closed: false,
  balance,
  clearedBalance: balance,
  ...extra,
});

const accounts = [
  account("chk", "checking", 1000),
  account("sav", "savings", 500),
  account("old", "checking", 50, { closed: true }),
  account("brk", "tracking", 9000, { onBudget: false }),
  account("cc", "creditCard", -200),
];

describe("previewCash", () => {
  it("sums the open on-budget cash accounts when nothing is mapped", () => {
    const { apiCash, onBudgetCashAccounts } = previewCash(
      { accountMappings: null },
      accounts,
    );
    expect(apiCash).toBe(1500);
    expect(onBudgetCashAccounts.map((a) => a.id)).toEqual(["chk", "sav"]);
  });

  it("takes only the pulled cash mappings once any exist", () => {
    const { apiCash } = previewCash(
      {
        accountMappings: [
          { localId: "cash", remoteAccountId: "sav", syncDirection: "pull" },
          { localId: "cash", remoteAccountId: "chk", syncDirection: "push" },
        ],
      },
      accounts,
    );
    expect(apiCash).toBe(500);
  });
});

const groups: BudgetCategoryGroup[] = [
  {
    id: "g1",
    name: "Bills",
    hidden: false,
    isIncome: false,
    categories: [
      {
        id: "c1",
        name: "🏠 Rent (monthly)",
        groupId: "g1",
        groupName: "Bills",
        hidden: false,
        budgeted: 0,
        activity: 0,
        balance: 0,
      },
      {
        id: "c2",
        name: "Old",
        groupId: "g1",
        groupName: "Bills",
        hidden: true,
        budgeted: 0,
        activity: 0,
        balance: 0,
      },
      {
        id: "c3",
        name: "Vacation",
        groupId: "g1",
        groupName: "Bills",
        hidden: false,
        budgeted: 0,
        activity: 0,
        balance: 0,
      },
      {
        id: "c4",
        name: "Gifts",
        groupId: "g1",
        groupName: "Bills",
        hidden: false,
        budgeted: 0,
        activity: 0,
        balance: 0,
      },
    ],
  },
];
const month = {
  data: {
    month: "2026-11-01",
    income: 0,
    budgeted: 0,
    activity: 0,
    toBeBudgeted: null,
    categories: [
      { ...groups[0]!.categories[0]!, budgeted: 1500, activity: -1500 },
      { ...groups[0]!.categories[2]!, balance: 800 },
    ],
  },
};

describe("previewApiCategories", () => {
  it("lists the visible categories with this month's figures, zero when the month has none", () => {
    const { apiCats } = previewApiCategories(month, groups);
    expect(apiCats.map((c) => [c.id, c.budgeted, c.balance])).toEqual([
      ["c1", 1500, 0],
      ["c3", 0, 800],
      ["c4", 0, 0],
    ]);
    expect(previewApiCategories(null, groups).apiCats[0]!.budgeted).toBe(0);
  });

  it("matches names without emoji, parentheses or case", () => {
    const { normalize } = previewApiCategories(month, groups);
    expect(normalize("🏠 Rent (monthly)")).toBe("rent");
    expect(normalize("  RENT ")).toBe("rent");
  });
});

describe("matching budget items and savings goals", () => {
  const { apiCats, normalize } = previewApiCategories(month, groups);
  const item = (
    id: number,
    subcategory: string,
    apiCategoryId: string | null,
  ) => ({
    id,
    category: "Housing",
    subcategory,
    amounts: [1400, 1200],
    apiCategoryId,
    apiCategoryName: apiCategoryId ? "Stored name" : null,
    apiSyncDirection: apiCategoryId ? ("push" as const) : null,
    contributionAccountId: null,
  });

  it("marks linked, orphaned, suggested and unmatched items, in that pass order", () => {
    const { budgetMatches, usedApiIds } = matchBudgetItems(
      [
        item(1, "Rent", "c1"),
        item(2, "Gone", "zz"),
        item(3, "Gifts", null),
        item(4, "Pets", null),
      ],
      apiCats,
      { index: 1, of: 2 },
      normalize,
    );
    expect(budgetMatches.map((m) => [m.budgetItemId, m.status])).toEqual([
      [1, "linked"],
      [2, "orphaned"],
      [3, "suggested"],
      [4, "unmatched"],
    ]);
    expect(budgetMatches[0]).toMatchObject({
      ledgrAmount: 1200,
      apiBudgeted: 1500,
      nameDrifted: true,
      categoryDrifted: true,
    });
    expect([...usedApiIds].sort()).toEqual(["c1", "c4", "zz"]);
  });

  it("matches savings goals to what the budget items left, and splits the rest by skipped", () => {
    const { usedApiIds } = matchBudgetItems(
      [item(1, "Rent", "c1")],
      apiCats,
      { index: 0, of: 2 },
      normalize,
    );
    const goal = (id: number, name: string) => ({
      id,
      name,
      isEmergencyFund: false,
      apiCategoryId: null,
      apiCategoryName: null,
      reimbursementApiCategoryId: null,
    });
    const { savingsMatches, unmatchedApi, skippedApi } = matchSavingsGoals(
      [goal(1, "Vacation"), goal(2, "Rent")],
      apiCats,
      usedApiIds,
      normalize,
      { skippedCategoryIds: ["c4"] },
    );
    expect(savingsMatches.map((m) => [m.goalId, m.status])).toEqual([
      [1, "suggested"],
      [2, "unmatched"],
    ]);
    expect(savingsMatches[0]!.apiBalance).toBe(800);
    expect(unmatchedApi).toEqual([]);
    expect(skippedApi.map((c) => c.id)).toEqual(["c4"]);
  });
});

describe("previewAssetAccounts", () => {
  it("carries each asset's latest value up to this year, largest first", () => {
    const { assetLocalAccounts } = previewAssetAccounts(
      [
        { id: 1, name: "Car", year: 2024, value: "20000" },
        { id: 2, name: "Car", year: 2025, value: "18000" },
        { id: 3, name: "Car", year: 2027, value: "1" },
        { id: 4, name: "Boat", year: 2023, value: "30000" },
      ],
      2026,
    );
    expect(assetLocalAccounts).toEqual([
      { label: "Boat", balance: 30000, id: 4 },
      { label: "Car", balance: 18000, id: 2 },
    ]);
  });
});
