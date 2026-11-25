/**
 * One budget item's amount in one column: every item holds one amount per
 * column, so a short item stops the read; a column outside the list is $0.
 */
import { describe, it, expect } from "vitest";
import {
  budgetColumnSum,
  budgetItemAmount,
  readableBudgetItemAmount,
  storedAmountList,
  storedBudgetAmount,
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

  it("sums a stored text amount as its number, never as text, and one that isn't a number as $0", () => {
    // As an install can store them (tag 0018 left "500" as text).
    const stored: number[] = JSON.parse('["500", "abc", " "]');
    const items = [{ amounts: [100, 200, 300] }, { amounts: stored }];
    expect(budgetColumnSum(items, 0, 3)).toBe(600);
    expect(budgetColumnSum(items, 1, 3)).toBe(200);
    expect(budgetColumnSum(items, 2, 3)).toBe(300);
  });
});

describe("storedBudgetAmount", () => {
  it("reads a number, or text that is one, and nothing else", () => {
    expect(storedBudgetAmount(12.5)).toBe(12.5);
    expect(storedBudgetAmount("500")).toBe(500);
    expect(storedBudgetAmount("-20.25")).toBe(-20.25);
    expect(storedBudgetAmount(" .5 ")).toBe(0.5);
    for (const unreadable of [
      "abc",
      "",
      " ",
      "0x10",
      "0b11",
      "1e3",
      "Infinity",
      null,
      {},
      [5],
    ])
      expect(storedBudgetAmount(unreadable)).toBeNull();
  });
});

describe("readableBudgetItemAmount", () => {
  it("is null for a stored value that isn't a number, $0 outside the list", () => {
    const stored: number[] = JSON.parse('["500", "abc"]');
    expect(readableBudgetItemAmount(stored, 0, 2)).toBe(500);
    expect(readableBudgetItemAmount(stored, 1, 2)).toBeNull();
    expect(readableBudgetItemAmount(stored, 2, 2)).toBe(0);
  });

  it("is null for saved amounts that aren't a list, never throwing", () => {
    for (const notAList of ["500", '{"0":5}', '"500"', "null"]) {
      const stored: number[] = JSON.parse(notAList);
      expect(readableBudgetItemAmount(stored, 0, 1)).toBeNull();
      expect(budgetColumnSum([{ amounts: stored }], 0, 1)).toBe(0);
    }
  });
});

describe("storedAmountList", () => {
  it("copies a stored list as stored, and is null for one that isn't a list", () => {
    const stored: number[] = JSON.parse('["500", 20]');
    const copy = storedAmountList(stored);
    expect(copy).toEqual(["500", 20]);
    expect(copy).not.toBe(stored);
    for (const notAList of ['{"0":5}', '"500"', "null"])
      expect(storedAmountList(JSON.parse(notAList))).toBeNull();
  });
});
