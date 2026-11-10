import { describe, it, expect } from "vitest";
import {
  getEssentialExpenses,
  resolveEfundTierIndex,
} from "@/lib/pure/savings/efund-expenses";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_EFUND_BUDGET_COLUMN,
} from "@/lib/constants/settings-keys";

// Invented household: budget profile 1 has three columns (lean, normal,
// comfortable); profile 2 is another household member's sandbox.
const budgetItems = [
  { profileId: 1, isEssential: true, amounts: [1500, 1800, 2200] }, // housing
  { profileId: 1, isEssential: true, amounts: [400, 600, 800] }, // groceries
  { profileId: 1, isEssential: false, amounts: [100, 300, 600] }, // dining out
  { profileId: 2, isEssential: true, amounts: [9000, 9000, 9000] },
];

const profile = {
  id: 1,
  columnLabels: ["Lean", "Normal", "Comfortable"],
  columnMonths: null,
};

describe("getEssentialExpenses", () => {
  it("sums one column of the profile's essential items, monthly", () => {
    expect(getEssentialExpenses(budgetItems, profile, 0)).toBe(1900);
    expect(getEssentialExpenses(budgetItems, profile, 2)).toBe(3000);
  });

  it("weighs every column by its months on a weighted profile", () => {
    // (1,900 × 6 + 2,400 × 4 + 3,000 × 2) / 12 = 2,250 a month
    expect(
      getEssentialExpenses(
        budgetItems,
        { ...profile, columnMonths: [6, 4, 2] },
        0,
      ),
    ).toBe(2250);
  });

  it("reads $0 for a column past the profile's columns", () => {
    expect(getEssentialExpenses(budgetItems, profile, 5)).toBe(0);
  });
});

describe("resolveEfundTierIndex", () => {
  const settings = (efund: unknown, active: unknown = 1) => [
    { key: SK_BUDGET_ACTIVE_COLUMN, value: active },
    { key: SK_EFUND_BUDGET_COLUMN, value: efund },
  ];

  it("takes the e-fund's saved column over the budget page's", () => {
    expect(resolveEfundTierIndex(settings(2), undefined, 3)).toBe(2);
  });

  it("takes an explicit override over both saved columns", () => {
    expect(resolveEfundTierIndex(settings(2), 0, 3)).toBe(0);
  });

  it("falls to the budget page's column when the e-fund's isn't a number", () => {
    expect(resolveEfundTierIndex(settings("2"), undefined, 3)).toBe(1);
    expect(resolveEfundTierIndex(settings(null), undefined, 3)).toBe(1);
  });

  it("falls to the budget page's column when the e-fund's is negative", () => {
    expect(resolveEfundTierIndex(settings(-1), undefined, 3)).toBe(1);
  });

  it("falls to column 0 when neither column is saved", () => {
    expect(resolveEfundTierIndex([], undefined, 3)).toBe(0);
    expect(resolveEfundTierIndex(settings(-1, "1"), undefined, 3)).toBe(0);
  });

  it("clamps a saved column past the end of a profile with fewer columns", () => {
    // Saved while a 3-column profile was active; a 1-column one is now.
    expect(resolveEfundTierIndex(settings(2), undefined, 1)).toBe(0);
    expect(resolveEfundTierIndex(settings(2), undefined, 2)).toBe(1);
  });

  it("doesn't clamp when the column count is 0 or not given", () => {
    expect(resolveEfundTierIndex(settings(2), undefined, 0)).toBe(2);
    expect(resolveEfundTierIndex(settings(2))).toBe(2);
  });
});
