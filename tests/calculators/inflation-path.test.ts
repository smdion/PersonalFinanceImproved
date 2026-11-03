/** The year-by-year inflation path every compounding site reads. */
import { describe, expect, it } from "vitest";
import { buildInflationPath } from "@/lib/calculators/engine/inflation-path";
import { taxGrowthFactor } from "@/lib/calculators/engine/bracket-growth";
import { applySpendingDecline } from "@/lib/calculators/engine/spending-decline";

const plan = {
  inflationRate: 0.03,
  postRetirementInflationRate: 0.02,
  baseYear: 2026,
};

describe("no shocks", () => {
  const p = buildInflationPath(plan);
  it("is exactly the closed forms", () => {
    expect(p.growth(17)).toBe(Math.pow(1.03, 17));
    expect(p.growthSinceVintage(2040, 2026)).toBe(
      taxGrowthFactor(2040, 2026, 0.03),
    );
    expect(p.growthSinceVintage(2040, 2026, 2)).toBe(
      taxGrowthFactor(2042, 2026, 0.03),
    );
    expect(p.shockedGrowthBetween(1, 5)).toBeNull();
  });
});

describe("with shocks", () => {
  const shocks = [0.5, 0.01, -0.01, 0, 0.02];
  const p = buildInflationPath({ ...plan, shocks });

  it("never compounds index 0, and each index compounds its own rate", () => {
    expect(p.growth(0)).toBe(1);
    expect(p.growth(1)).toBeCloseTo(1.04, 12);
    expect(p.growth(2)).toBeCloseTo(1.04 * 1.02, 12);
  });

  it("one shock moves both rates, keeping the gap", () => {
    expect(p.rate(1) - p.postRate(1)).toBeCloseTo(0.01, 12);
    expect(p.rate(2) - p.postRate(2)).toBeCloseTo(0.01, 12);
  });

  it("stays finite past the shocks, at the plan's rate", () => {
    expect(p.growth(6)).toBeCloseTo(p.growth(4) * 1.03 ** 2, 10);
    expect(p.rate(9)).toBe(0.03);
    expect(Number.isFinite(p.growthSinceVintage(2031, 2026, 2))).toBe(true);
  });

  it("grows a table from its own vintage", () => {
    // Older than the plan's start: the plan's rate up to it, then the path.
    expect(p.growthSinceVintage(2028, 2024)).toBeCloseTo(
      1.03 ** 2 * p.growth(2),
      10,
    );
    expect(p.growthSinceVintage(2028, 2026)).toBeCloseTo(p.growth(2), 10);
    // Newer: only the years since it.
    expect(p.growthSinceVintage(2029, 2027)).toBeCloseTo(
      p.growth(3) / p.growth(1),
      10,
    );
    expect(p.growthSinceVintage(2027, 2028)).toBe(1);
    expect(p.growthSinceVintage(2028, undefined)).toBe(1);
  });

  it("a look ahead uses the plan's rate, not a future year's draw", () => {
    expect(p.growthSinceVintage(2027, 2026, 2)).toBeCloseTo(
      p.growth(1) * 1.03 ** 2,
      10,
    );
  });

  it("keeps a wild draw from reaching zero, without a tighter clamp", () => {
    const wild = buildInflationPath({ ...plan, shocks: [0, -5, 0.3] });
    expect(wild.rate(1)).toBe(-0.5);
    expect(wild.rate(2)).toBeCloseTo(0.33, 12);
  });
});

describe("Spending Decline in a trial", () => {
  // Bug pin (strategies verdict N2): this asserts the closed form from the
  // first amount, which ignores typed budgets and expense endings. The
  // answer key's strategies/N2 (61,133.30, answer-key-strategies.test.ts)
  // replaces it in v0.11 Strategies "RMD Spending starts at a hard-coded
  // 72" (Spending Decline: carry last year's amount). Values unchanged.
  it("uses the CPI each year saw, not this year's rate for every year", () => {
    const result = applySpendingDecline({ annualDeclineRate: 0.02 }, {
      projectedExpenses: 1,
      portfolioBalance: 1,
      effectiveInflation: 0.1,
      cpiInflation: 0.1, // this year's spike
      cpiGrowthSinceStart: 1.1 * 1.02 * 1.02,
      hasBudgetOverride: false,
      yearIndex: 13,
      age: 68,
      crossYearState: {
        decumulationYearCount: 3,
        initialWithdrawalAmount: 50_000,
      },
    } as never);
    expect(result.projectedExpenses).toBeCloseTo(
      50_000 * 1.1 * 1.02 * 1.02 * 0.98 ** 3,
      2,
    );
  });
});
