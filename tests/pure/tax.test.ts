/**
 * Tests for pure household tax computation logic.
 * Covers: computeHouseholdTax, combinedPreTaxDeductions.
 */
import { describe, it, expect } from "vitest";
import { computeHouseholdTax, combinedPreTaxDeductions } from "@/lib/pure/tax";

describe("computeHouseholdTax", () => {
  it("computes household tax from two earners", () => {
    const people = [
      {
        salary: 100000,
        preTaxDeductionsAnnual: 0,
        ficaSS: 6200,
        ficaMedicare: 1450,
      },
      {
        salary: 80000,
        preTaxDeductionsAnnual: 0,
        ficaSS: 4960,
        ficaMedicare: 1160,
      },
    ];
    const combinedTaxResult = { federalTax: 25000, marginalRate: 0.22 };

    const result = computeHouseholdTax(people, combinedTaxResult);

    expect(result.federalTax).toBe(25000);
    expect(result.ficaSS).toBe(11160); // 6200 + 4960
    expect(result.ficaMedicare).toBe(2610); // 1450 + 1160
    expect(result.totalTax).toBe(38770); // 25000 + 11160 + 2610
    expect(result.effectiveRate).toBeCloseTo(38770 / 180000);
    expect(result.marginalRate).toBe(0.22);
  });

  it("handles zero gross income", () => {
    const people = [
      { salary: 0, preTaxDeductionsAnnual: 0, ficaSS: 0, ficaMedicare: 0 },
    ];
    const result = computeHouseholdTax(people, {
      federalTax: 0,
      marginalRate: 0,
    });
    expect(result.effectiveRate).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it("handles single earner", () => {
    const people = [
      {
        salary: 150000,
        preTaxDeductionsAnnual: 0,
        ficaSS: 9300,
        ficaMedicare: 2175,
      },
    ];
    const result = computeHouseholdTax(people, {
      federalTax: 30000,
      marginalRate: 0.24,
    });
    expect(result.totalTax).toBe(30000 + 9300 + 2175);
    expect(result.effectiveRate).toBeCloseTo(41475 / 150000);
  });
});

describe("combinedPreTaxDeductions", () => {
  it("scales per-period deductions by periods per year", () => {
    const people = [
      { preTaxPerPeriod: 500, periodsPerYear: 26 }, // biweekly
      { preTaxPerPeriod: 800, periodsPerYear: 12 }, // monthly
    ];
    expect(combinedPreTaxDeductions(people)).toBe(500 * 26 + 800 * 12);
  });

  it("returns 0 for empty array", () => {
    expect(combinedPreTaxDeductions([])).toBe(0);
  });
});
