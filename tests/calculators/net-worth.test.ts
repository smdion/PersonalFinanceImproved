import { describe, it, expect } from "vitest";
import { calculateNetWorth } from "@/lib/calculators/net-worth";
import type { NetWorthInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

describe("calculateNetWorth", () => {
  const input: NetWorthInput = {
    portfolioTotal: 650000,
    cash: 5000,
    homeValueEstimated: 550000,
    homeValueConservative: 425000,
    otherAssets: 15000,
    mortgageBalance: 260000,
    otherLiabilities: 0,
    annualSalary: 230000, // combined household
    annualExpenses: 84000, // ~$7,000/month
    withdrawalRate: 0.04,
    age: 35, // primary user
    yearsWorking: 13,
    asOfDate: AS_OF_DATE,
  };

  it("computes net worth (market) using estimated home value", () => {
    const result = calculateNetWorth(input);
    // 650000 + 5000 + 550000 + 15000 - 260000 - 0 = 960000
    expect(result.netWorthMarket).toBe(960000);
    expect(result.netWorth).toBe(960000); // alias
  });

  it("computes net worth (cost basis) using purchase + improvements", () => {
    const result = calculateNetWorth(input);
    // 650000 + 5000 + 425000 + 15000 - 260000 - 0 = 835000
    expect(result.netWorthCostBasis).toBe(835000);
  });

  it("computes wealth score using Millionaire Next Door formula", () => {
    const result = calculateNetWorth(input);
    // Expected NW = ((35 × 230000) / (10 + max(0, 40-35))) × 2
    // = (8050000 / 15) × 2 = 1073333.33
    // Score = 960000 / 1073333.33 ≈ 0.894
    expect(result.wealthTarget).toBeCloseTo(1073333, 0);
    expect(result.wealthScore).toBeCloseTo(0.894, 1);
  });

  it("computes FI progress from portfolio + cash only", () => {
    const result = calculateNetWorth(input);
    // FI target = $84,000 / 0.04 = $2,100,000
    expect(result.fiTarget).toBe(2100000);
    // FI progress = (650000 + 5000) / 2100000 ≈ 0.3119
    expect(result.fiProgress).toBeCloseTo(0.312, 2);
  });

  describe("age 40+ adjustment", () => {
    it("uses denominator of 10 for age 40+", () => {
      const older = { ...input, age: 45 };
      const result = calculateNetWorth(older);
      // Expected NW = ((45 × 230000) / 10) × 2 = 2,070,000
      expect(result.wealthTarget).toBeCloseTo(2070000, 0);
    });
  });

  describe("edge cases", () => {
    it("handles zero income without error", () => {
      const result = calculateNetWorth({ ...input, annualSalary: 0 });
      expect(result.wealthScore).toBe(0);
      expect(result.wealthTarget).toBe(0);
    });

    it("handles zero expenses without error", () => {
      const result = calculateNetWorth({ ...input, annualExpenses: 0 });
      expect(result.fiTarget).toBe(0);
      expect(result.fiProgress).toBe(0);
    });

    it("handles zero withdrawal rate without error", () => {
      const result = calculateNetWorth({ ...input, withdrawalRate: 0 });
      expect(result.fiTarget).toBe(0);
    });
  });
});
