/**
 * One budget item's amount in one column: every item holds one amount per
 * column, so a short item stops the read; a column outside the list is $0.
 */
import { describe, it, expect } from "vitest";
import {
  budgetColumnSum,
  budgetItemAmount,
} from "@/lib/pure/budget/item-amount";

describe("budgetItemAmount", () => {
  it("reads the item's amount in a column of the list", () => {
    expect(budgetItemAmount([100, 0, 30], 1, 3)).toBe(0);
    expect(budgetItemAmount([100, 0, 30], 2, 3)).toBe(30);
  });

  it("reads a column outside the list as no budget", () => {
    expect(budgetItemAmount([100, 200], 2, 2)).toBe(0);
    expect(budgetItemAmount([100, 200], -1, 2)).toBe(0);
    expect(budgetItemAmount([], 0, 0)).toBe(0);
  });

  it("stops at an item short of a column of the list, naming counts only", () => {
    expect(() => budgetItemAmount([100], 1, 3)).toThrow(
      "A budget item holds 1 amounts for 3 columns",
    );
  });
});

describe("budgetColumnSum", () => {
  it("sums one column of the items", () => {
    const items = [{ amounts: [100, 200] }, { amounts: [50, 75] }];
    expect(budgetColumnSum(items, 1, 2)).toBe(275);
    expect(budgetColumnSum(items, 2, 2)).toBe(0);
  });
});
