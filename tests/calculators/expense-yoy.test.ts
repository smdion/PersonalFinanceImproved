import { describe, it, expect } from "vitest";
import { calculateExpenseYoY } from "@/lib/calculators/expense-yoy";
import type { ExpenseYoYInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

function makeInput(overrides: Partial<ExpenseYoYInput> = {}): ExpenseYoYInput {
  return {
    currentPeriod: [],
    priorPeriod: [],
    asOfDate: AS_OF_DATE,
    ...overrides,
  };
}

describe("calculateExpenseYoY", () => {
  describe("empty inputs", () => {
    it("warns when both periods are empty", () => {
      const result = calculateExpenseYoY(makeInput());
      expect(result.warnings).toContain("No current period data available");
      expect(result.warnings).toContain("No prior period data available");
      expect(result.categories).toEqual([]);
      expect(result.grandCurrentTotal).toBe(0);
      expect(result.grandPriorTotal).toBe(0);
    });

    it("warns when only current period is empty", () => {
      const result = calculateExpenseYoY(
        makeInput({
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 500 },
          ],
        }),
      );
      expect(result.warnings).toContain("No current period data available");
      expect(result.warnings).not.toContain("No prior period data available");
    });

    it("warns when only prior period is empty", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 600 },
          ],
        }),
      );
      expect(result.warnings).toContain("No prior period data available");
      expect(result.warnings).not.toContain("No current period data available");
    });
  });

  describe("single category", () => {
    it("computes dollar and percent change", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 600 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 500 },
          ],
        }),
      );
      expect(result.categories).toHaveLength(1);
      const cat = result.categories[0]!;
      expect(cat.category).toBe("Food");
      expect(cat.currentTotal).toBe(600);
      expect(cat.priorTotal).toBe(500);
      expect(cat.dollarChange).toBe(100);
      expect(cat.percentChange).toBeCloseTo(0.2, 4);
    });

    it("returns null percentChange when prior is zero", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [{ category: "New", subcategory: "Sub", amount: 200 }],
          priorPeriod: [],
        }),
      );
      const cat = result.categories[0]!;
      expect(cat.priorTotal).toBe(0);
      expect(cat.percentChange).toBeNull();
    });
  });

  describe("subcategory breakdown", () => {
    it("breaks down by subcategory within a category", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 400 },
            { category: "Food", subcategory: "Dining", amount: 200 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 350 },
            { category: "Food", subcategory: "Dining", amount: 250 },
          ],
        }),
      );
      const cat = result.categories[0]!;
      expect(cat.subcategories).toHaveLength(2);

      // Sorted alphabetically
      expect(cat.subcategories[0]!.subcategory).toBe("Dining");
      expect(cat.subcategories[1]!.subcategory).toBe("Groceries");

      const dining = cat.subcategories[0]!;
      expect(dining.current).toBe(200);
      expect(dining.prior).toBe(250);
      expect(dining.dollarChange).toBe(-50);
      expect(dining.percentChange).toBeCloseTo(-0.2, 4);
    });

    it("handles subcategory only in current period", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Delivery", amount: 100 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 300 },
          ],
        }),
      );
      const cat = result.categories[0]!;
      const delivery = cat.subcategories.find(
        (s) => s.subcategory === "Delivery",
      )!;
      expect(delivery.current).toBe(100);
      expect(delivery.prior).toBe(0);
      expect(delivery.percentChange).toBeNull();

      const groceries = cat.subcategories.find(
        (s) => s.subcategory === "Groceries",
      )!;
      expect(groceries.current).toBe(0);
      expect(groceries.prior).toBe(300);
    });
  });

  describe("multiple categories", () => {
    it("sorts categories alphabetically", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Utilities", subcategory: "Electric", amount: 100 },
            { category: "Food", subcategory: "Groceries", amount: 500 },
            { category: "Auto", subcategory: "Gas", amount: 200 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 450 },
            { category: "Auto", subcategory: "Gas", amount: 180 },
          ],
        }),
      );
      expect(result.categories.map((c) => c.category)).toEqual([
        "Auto",
        "Food",
        "Utilities",
      ]);
    });
  });

  describe("grand totals", () => {
    it("sums across all categories", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 500 },
            { category: "Auto", subcategory: "Gas", amount: 200 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 400 },
            { category: "Auto", subcategory: "Gas", amount: 250 },
          ],
        }),
      );
      expect(result.grandCurrentTotal).toBe(700);
      expect(result.grandPriorTotal).toBe(650);
      expect(result.grandDollarChange).toBe(50);
      expect(result.grandPercentChange).toBeCloseTo(50 / 650, 4);
    });

    it("returns null grandPercentChange when prior total is zero", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 500 },
          ],
        }),
      );
      expect(result.grandPercentChange).toBeNull();
    });
  });

  describe("aggregation", () => {
    it("sums multiple items in the same category and subcategory", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 100 },
            { category: "Food", subcategory: "Groceries", amount: 150 },
            { category: "Food", subcategory: "Groceries", amount: 250 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 400 },
          ],
        }),
      );
      const cat = result.categories[0]!;
      expect(cat.currentTotal).toBe(500);
      expect(cat.priorTotal).toBe(400);
    });
  });

  describe("rounding", () => {
    it("rounds to cents", () => {
      const result = calculateExpenseYoY(
        makeInput({
          currentPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 100.555 },
          ],
          priorPeriod: [
            { category: "Food", subcategory: "Groceries", amount: 200.444 },
          ],
        }),
      );
      const cat = result.categories[0]!;
      // roundToCents should round these
      expect(cat.currentTotal).toBe(100.56);
      expect(cat.priorTotal).toBe(200.44);
      expect(cat.dollarChange).toBe(-99.88);
    });
  });
});
