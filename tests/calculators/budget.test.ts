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

describe("calculateBudget — branch coverage", () => {
  it("warns when selectedColumn exceeds an item's amounts length", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard", "Tight", "Emergency"],
      selectedColumn: 2,
      items: [
        {
          category: "Housing",
          label: "Rent",
          amounts: [1000, 800], // only 2 columns, requesting column 2
          isEssential: true,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.warnings).toContainEqual(
      expect.stringContaining(
        'Budget item "Rent" has 2 columns but column 2 was requested',
      ),
    );
    // Falls back to $0
    expect(result.totalMonthly).toBe(0);
    expect(result.essentialTotal).toBe(0);
  });

  it("handles all-essential items (no discretionary)", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        {
          category: "Housing",
          label: "Rent",
          amounts: [2000],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Groceries",
          amounts: [500],
          isEssential: true,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.essentialTotal).toBe(2500);
    expect(result.discretionaryTotal).toBe(0);
    expect(result.totalMonthly).toBe(2500);
  });

  it("handles all-discretionary items (no essential)", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        {
          category: "Fun",
          label: "Entertainment",
          amounts: [200],
          isEssential: false,
        },
        {
          category: "Fun",
          label: "Dining Out",
          amounts: [150],
          isEssential: false,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.essentialTotal).toBe(0);
    expect(result.discretionaryTotal).toBe(350);
    expect(result.totalMonthly).toBe(350);
  });

  it("selects column 2 (Emergency) correctly", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard", "Tight", "Emergency"],
      selectedColumn: 2,
      items: [
        {
          category: "Housing",
          label: "Rent",
          amounts: [2000, 2000, 2000],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Groceries",
          amounts: [800, 600, 400],
          isEssential: true,
        },
        {
          category: "Fun",
          label: "Dining",
          amounts: [300, 100, 0],
          isEssential: false,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    // Emergency column: 2000 + 400 + 0 = 2400
    expect(result.totalMonthly).toBe(2400);
    expect(result.essentialTotal).toBe(2400);
    expect(result.discretionaryTotal).toBe(0);
  });

  it("handles a single item", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        {
          category: "Housing",
          label: "Mortgage",
          amounts: [1500.5],
          isEssential: true,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.totalMonthly).toBeCloseTo(1500.5, 2);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]!.name).toBe("Housing");
    expect(result.categories[0]!.items).toHaveLength(1);
  });

  it("rounds amounts to cents", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        { category: "A", label: "Item1", amounts: [33.333], isEssential: true },
        {
          category: "A",
          label: "Item2",
          amounts: [66.667],
          isEssential: false,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    // Each item rounded to cents: 33.33 + 66.67 = 100.00
    expect(result.totalMonthly).toBeCloseTo(100.0, 2);
  });

  it("handles items with empty amounts array gracefully", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        { category: "Housing", label: "Empty", amounts: [], isEssential: true },
        {
          category: "Food",
          label: "Groceries",
          amounts: [500],
          isEssential: true,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    // Empty amounts => col 0 out of bounds => warning + $0
    expect(result.warnings).toContainEqual(
      expect.stringContaining(
        'Budget item "Empty" has 0 columns but column 0 was requested',
      ),
    );
    expect(result.totalMonthly).toBe(500);
  });

  it("has correct per-category totals and item breakdown", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        {
          category: "Housing",
          label: "Mortgage",
          amounts: [1820],
          isEssential: true,
        },
        {
          category: "Housing",
          label: "Insurance",
          amounts: [90],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Groceries",
          amounts: [800],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Dining",
          amounts: [300],
          isEssential: false,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    const housing = result.categories.find((c) => c.name === "Housing")!;
    expect(housing.total).toBe(1910);
    expect(housing.items).toHaveLength(2);
    expect(housing.items[0]!.label).toBe("Mortgage");
    expect(housing.items[0]!.isEssential).toBe(true);

    const food = result.categories.find((c) => c.name === "Food")!;
    expect(food.total).toBe(1100);
    expect(food.items).toHaveLength(2);
  });

  it("has no warnings for valid inputs", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [{ category: "A", label: "X", amounts: [100], isEssential: true }],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns empty categories for non-empty columnLabels but empty items", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.totalMonthly).toBe(0);
    expect(result.essentialTotal).toBe(0);
    expect(result.discretionaryTotal).toBe(0);
    expect(result.categories).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("mixes essential and discretionary within same category", () => {
    const input: BudgetInput = {
      columnLabels: ["Standard"],
      selectedColumn: 0,
      items: [
        {
          category: "Food",
          label: "Groceries",
          amounts: [600],
          isEssential: true,
        },
        {
          category: "Food",
          label: "Dining",
          amounts: [200],
          isEssential: false,
        },
      ],
      asOfDate: AS_OF_DATE,
    };

    const result = calculateBudget(input);
    expect(result.essentialTotal).toBe(600);
    expect(result.discretionaryTotal).toBe(200);
    const food = result.categories.find((c) => c.name === "Food")!;
    expect(food.total).toBe(800);
  });
});
