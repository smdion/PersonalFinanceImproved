import { describe, it, expect } from "vitest";
import { calculateBudget } from "@/lib/calculators/budget";
import type { BudgetInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

describe("calculateBudget", () => {
  const input: BudgetInput = {
    columnLabels: ["Standard", "Tight", "Emergency"],
    selectedColumn: 0,
    items: [
      // Housing
      {
        category: "Housing",
        label: "Mortgage P&I",
        amounts: [1820.0, 1820.0, 1820.0],
        isEssential: true,
      },
      {
        category: "Housing",
        label: "Property Tax",
        amounts: [535.0, 535.0, 535.0],
        isEssential: true,
      },
      {
        category: "Housing",
        label: "Home Insurance",
        amounts: [90.0, 90.0, 90.0],
        isEssential: true,
      },
      // Utilities
      {
        category: "Utilities",
        label: "Electric",
        amounts: [175.0, 150.0, 100.0],
        isEssential: true,
      },
      {
        category: "Utilities",
        label: "Gas",
        amounts: [75.0, 60.0, 40.0],
        isEssential: true,
      },
      {
        category: "Utilities",
        label: "Water/Sewer",
        amounts: [60.0, 60.0, 60.0],
        isEssential: true,
      },
      {
        category: "Utilities",
        label: "Internet",
        amounts: [75.0, 75.0, 0],
        isEssential: true,
      },
      // Food
      {
        category: "Food",
        label: "Groceries",
        amounts: [800.0, 600.0, 400.0],
        isEssential: true,
      },
      {
        category: "Food",
        label: "Dining Out",
        amounts: [300.0, 100.0, 0],
        isEssential: false,
      },
      // Transportation
      {
        category: "Transportation",
        label: "Gas/Fuel",
        amounts: [200.0, 150.0, 100.0],
        isEssential: true,
      },
      {
        category: "Transportation",
        label: "Auto Insurance",
        amounts: [180.0, 180.0, 180.0],
        isEssential: true,
      },
      // Personal
      {
        category: "Personal",
        label: "Subscriptions",
        amounts: [150.0, 50.0, 0],
        isEssential: false,
      },
      {
        category: "Personal",
        label: "Entertainment",
        amounts: [200.0, 75.0, 0],
        isEssential: false,
      },
      // Insurance
      {
        category: "Insurance",
        label: "Life Insurance",
        amounts: [85.0, 85.0, 85.0],
        isEssential: true,
      },
      // Kids
      {
        category: "Kids",
        label: "Daycare",
        amounts: [1500.0, 1500.0, 1500.0],
        isEssential: true,
      },
      {
        category: "Kids",
        label: "Activities",
        amounts: [200.0, 100.0, 0],
        isEssential: false,
      },
      // Misc
      {
        category: "Misc",
        label: "Gifts/Charity",
        amounts: [200.0, 100.0, 50.0],
        isEssential: false,
      },
      {
        category: "Misc",
        label: "Miscellaneous",
        amounts: [256.49, 100.0, 50.0],
        isEssential: false,
      },
    ],
    asOfDate: AS_OF_DATE,
  };

  it("computes total monthly budget (Standard column)", () => {
    const result = calculateBudget(input);
    // Sum of all Standard amounts
    expect(result.totalMonthly).toBeCloseTo(6901.49, 2);
  });

  it("splits essential vs discretionary", () => {
    const result = calculateBudget(input);
    // Essential: mortgage+tax+ins+utilities+groceries+gas+auto ins+life+daycare
    // Discretionary: dining+subscriptions+entertainment+activities+gifts+misc
    expect(result.essentialTotal).toBeGreaterThan(0);
    expect(result.discretionaryTotal).toBeGreaterThan(0);
    expect(result.essentialTotal + result.discretionaryTotal).toBeCloseTo(
      result.totalMonthly,
      2,
    );
  });

  it("groups items by category", () => {
    const result = calculateBudget(input);
    const categoryNames = result.categories.map((c) => c.name);
    expect(categoryNames).toContain("Housing");
    expect(categoryNames).toContain("Food");
    expect(categoryNames).toContain("Utilities");
  });

  it("uses selected column for amounts", () => {
    // Tight budget (column 1) should be less than Standard (column 0)
    const standard = calculateBudget(input);
    const tight = calculateBudget({ ...input, selectedColumn: 1 });
    expect(tight.totalMonthly).toBeLessThan(standard.totalMonthly);
  });

  it("handles empty budget gracefully", () => {
    const empty: BudgetInput = {
      items: [],
      columnLabels: [],
      selectedColumn: 0,
      asOfDate: AS_OF_DATE,
    };
    const result = calculateBudget(empty);
    expect(result.totalMonthly).toBe(0);
    expect(result.warnings).toContainEqual("No budget columns defined");
  });
});
