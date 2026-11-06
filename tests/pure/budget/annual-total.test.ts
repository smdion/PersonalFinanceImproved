/**
 * The budget's annual totals: one column, the weighted mix, and the
 * active-column total.
 */
import { describe, it, expect } from "vitest";
import {
  computeBudgetColumnTotal,
  computeWeightedBudgetTotal,
  computeBudgetAnnualTotal,
} from "@/lib/pure/budget/annual-total";

// ---------------------------------------------------------------------------
// computeBudgetColumnTotal (pure)
// ---------------------------------------------------------------------------

describe("computeBudgetColumnTotal", () => {
  it("returns 0 for empty items array", () => {
    expect(computeBudgetColumnTotal([], 0)).toBe(0);
  });

  it("annualizes monthly total (×12)", () => {
    const items = [{ amounts: [100, 200] }, { amounts: [50, 75] }];
    // Column 0: (100 + 50) × 12 = 1800
    expect(computeBudgetColumnTotal(items, 0)).toBe(1800);
  });

  it("uses correct column index", () => {
    const items = [{ amounts: [100, 200, 300] }, { amounts: [10, 20, 30] }];
    // Column 2: (300 + 30) × 12 = 3960
    expect(computeBudgetColumnTotal(items, 2)).toBe(3960);
  });

  it("treats missing amounts as 0", () => {
    const items = [{ amounts: [100] }, { amounts: [50, 75] }];
    // Column 1: (0 + 75) × 12 = 900
    expect(computeBudgetColumnTotal(items, 1)).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// computeWeightedBudgetTotal (pure)
// ---------------------------------------------------------------------------

describe("computeWeightedBudgetTotal", () => {
  it("returns 0 for empty items", () => {
    expect(computeWeightedBudgetTotal([], [6, 6])).toBe(0);
  });

  it("weights columns by month count", () => {
    const items = [{ amounts: [1000, 500] }];
    // Col 0: 1000 × 8 = 8000, Col 1: 500 × 4 = 2000 → 10000
    expect(computeWeightedBudgetTotal(items, [8, 4])).toBe(10000);
  });

  it("handles uniform weights (equivalent to single tier)", () => {
    const items = [{ amounts: [200] }];
    // 200 × 12 = 2400
    expect(computeWeightedBudgetTotal(items, [12])).toBe(2400);
  });

  it("handles three columns", () => {
    const items = [{ amounts: [100, 200, 300] }, { amounts: [50, 50, 50] }];
    // Col 0: (100+50)×4 = 600, Col 1: (200+50)×4 = 1000, Col 2: (300+50)×4 = 1400
    expect(computeWeightedBudgetTotal(items, [4, 4, 4])).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// computeBudgetAnnualTotal (pure, delegates)
// ---------------------------------------------------------------------------

describe("computeBudgetAnnualTotal", () => {
  const items = [{ amounts: [100, 200] }];

  it("uses weighted when columnMonths provided", () => {
    // Weighted: 100×6 + 200×6 = 1800
    expect(computeBudgetAnnualTotal(items, 0, [6, 6])).toBe(1800);
  });

  it("uses column total when columnMonths is null", () => {
    // Tier mode col 0: 100 × 12 = 1200
    expect(computeBudgetAnnualTotal(items, 0, null)).toBe(1200);
  });

  it("uses column total for col 1 when null", () => {
    // Tier mode col 1: 200 × 12 = 2400
    expect(computeBudgetAnnualTotal(items, 1, null)).toBe(2400);
  });
});
