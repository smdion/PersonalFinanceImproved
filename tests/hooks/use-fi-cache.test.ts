/**
 * Tests for deriveFI (R45 Step 4, Findings 8/13): the FI-target formula
 * consolidation. deriveFI used to reimplement `annualExpenses /
 * withdrawalRate` with raw division (no divide-by-zero guard) independently
 * of calculateNetWorth's safeDivide-guarded version — now both call the
 * same computeFiTarget helper.
 */
import { describe, it, expect } from "vitest";
import { deriveFI } from "@/lib/hooks/use-fi-cache";
import {
  computeFiTarget,
  calculateNetWorth,
} from "@/lib/calculators/net-worth";

describe("computeFiTarget", () => {
  it("matches calculateNetWorth's fiTarget for the same inputs", () => {
    const annualExpenses = 84000;
    const withdrawalRate = 0.04;
    const direct = computeFiTarget(annualExpenses, withdrawalRate);
    const viaNetWorth = calculateNetWorth({
      portfolioTotal: 0,
      cash: 0,
      homeValueEstimated: 0,
      homeValueConservative: 0,
      otherAssets: 0,
      mortgageBalance: 0,
      otherLiabilities: 0,
      averageAge: 40,
      effectiveIncome: 100000,
      lifetimeEarnings: 500000,
      annualExpenses,
      withdrawalRate,
    }).fiTarget;
    expect(direct).toBe(viaNetWorth);
    expect(direct).toBe(2100000);
  });

  it("guards divide-by-zero (0% withdrawal rate) instead of returning Infinity", () => {
    expect(computeFiTarget(84000, 0)).toBe(0);
  });
});

describe("deriveFI", () => {
  const projectionByYear = [
    { year: 2026, age: 40, endBalance: 500000 },
    { year: 2027, age: 41, endBalance: 1000000 },
    { year: 2028, age: 42, endBalance: 2100000 },
    { year: 2029, age: 43, endBalance: 2500000 },
  ];

  it("finds the first year the balance crosses computeFiTarget's value", () => {
    const result = deriveFI(projectionByYear, 84000, 0.04);
    expect(result.fiYear).toBe(2028);
    expect(result.fiAge).toBe(42);
  });

  it("returns null fiYear/fiAge when the target is never reached", () => {
    const result = deriveFI(projectionByYear, 999999, 0.04);
    expect(result.fiYear).toBeNull();
    expect(result.fiAge).toBeNull();
  });

  it("does not throw or return NaN-driven results when withdrawalRate is 0", () => {
    // computeFiTarget(x, 0) === 0, so the very first year (balance >= 0)
    // should be treated as "already FI" rather than crashing on a raw
    // division producing Infinity.
    const result = deriveFI(projectionByYear, 84000, 0);
    expect(result.fiYear).toBe(2026);
  });
});
