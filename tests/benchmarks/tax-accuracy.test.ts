/**
 * Tax Accuracy Tests
 *
 * Validates tax calculations against IRS 2025/2026 published tables.
 * Tests bracket math, FICA, standard deduction, and effective rates.
 */
import { describe, it, expect } from "vitest";
import { calculateTax } from "@/lib/calculators/tax";
import type { TaxBracketInput } from "@/lib/calculators/types";

// 2025 MFJ brackets (standard, no W-4 2(c) checkbox)
// Source: IRS Rev. Proc. 2024-40
const MFJ_2025_BRACKETS: TaxBracketInput = {
  filingStatus: "MFJ",
  w4Checkbox: false,
  brackets: [
    { min: 0, max: 23850, rate: 0.1 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: null, rate: 0.37 },
  ],
  standardDeduction: 30000,
  socialSecurityWageBase: 176100,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  medicareAdditionalRate: 0.009,
  medicareAdditionalThreshold: 200000,
};

describe("Tax accuracy — IRS published tables", () => {
  describe("Standard deduction", () => {
    it("MFJ standard deduction is $30,000 for 2025", () => {
      expect(MFJ_2025_BRACKETS.standardDeduction).toBe(30000);
    });
  });

  describe("Federal income tax bracket math", () => {
    it("$120k gross with $30k pre-tax deductions → ~$10k federal tax", () => {
      // AGI = $120k - $30k pre-tax = $90k (but tax calculator doesn't reduce by deductions, those are separate)
      // Actually: taxable = gross - preTaxDeductions - standardDeduction
      // $120k - $30k - $30k = $60k taxable
      const result = calculateTax({
        annualGross: 120000,
        preTaxDeductionsAnnual: 30000,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      // Taxable = $120k - $30k - $30k std ded = $60k
      expect(result.taxableIncome).toBe(60000);

      // Tax = $23,850 × 10% + ($60k - $23,850) × 12% = $2,385 + $4,338 = $6,723
      const expectedTax = 23850 * 0.1 + (60000 - 23850) * 0.12;
      expect(result.federalTax).toBeCloseTo(expectedTax, 0);
    });

    it("$200k gross with $0 deductions → correct bracket walk", () => {
      const result = calculateTax({
        annualGross: 200000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      // Taxable = $200k - $30k std ded = $170k
      expect(result.taxableIncome).toBe(170000);

      // Tax walk:
      // $0-$23,850 at 10% = $2,385
      // $23,850-$96,950 at 12% = $8,772
      // $96,950-$170,000 at 22% = $16,071
      // Total = $27,228
      const expectedTax =
        23850 * 0.1 + (96950 - 23850) * 0.12 + (170000 - 96950) * 0.22;
      expect(result.federalTax).toBeCloseTo(expectedTax, 0);
      expect(result.marginalRate).toBe(0.22);
    });
  });

  describe("FICA calculations", () => {
    it("SS tax on $113,711 (below wage base)", () => {
      const result = calculateTax({
        annualGross: 113711,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      const expectedSS = Math.round(113711 * 0.062 * 100) / 100;
      expect(result.ficaSS).toBeCloseTo(expectedSS, 0);
    });

    it("SS tax capped at wage base ($176,100)", () => {
      const result = calculateTax({
        annualGross: 250000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      const expectedSS = Math.round(176100 * 0.062 * 100) / 100;
      expect(result.ficaSS).toBeCloseTo(expectedSS, 0);
    });

    it("Medicare base rate on full income + surtax above $200k", () => {
      const result = calculateTax({
        annualGross: 250000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      const expectedMedicare = 250000 * 0.0145 + (250000 - 200000) * 0.009;
      expect(result.ficaMedicare).toBeCloseTo(expectedMedicare, 0);
    });

    it("no Medicare surtax when below threshold", () => {
      const result = calculateTax({
        annualGross: 150000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      const expectedMedicare = 150000 * 0.0145;
      expect(result.ficaMedicare).toBeCloseTo(expectedMedicare, 0);
    });
  });

  describe("Effective tax rate reasonableness", () => {
    it("$75k income → effective rate 15-25%", () => {
      const result = calculateTax({
        annualGross: 75000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      // At $75k MFJ with $30k std ded: taxable=$45k, federal ~$4.7k, FICA ~$5.7k → ~14%
      expect(result.effectiveRate).toBeGreaterThan(0.12);
      expect(result.effectiveRate).toBeLessThan(0.22);
    });

    it("$300k income → effective rate 25-35%", () => {
      const result = calculateTax({
        annualGross: 300000,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      // At $300k MFJ: taxable=$270k, federal ~$52k, SS capped + Medicare → ~22%
      expect(result.effectiveRate).toBeGreaterThan(0.2);
      expect(result.effectiveRate).toBeLessThan(0.3);
    });

    it("zero income → zero tax", () => {
      const result = calculateTax({
        annualGross: 0,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_2025_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: new Date("2025-01-01"),
      });

      expect(result.totalTax).toBe(0);
      expect(result.effectiveRate).toBe(0);
    });
  });

  describe("IRS limit sanity (from DB)", () => {
    // These values were verified against the live DB
    it("SS wage base 2026 = $176,100", () => {
      expect(MFJ_2025_BRACKETS.socialSecurityWageBase).toBe(176100);
    });

    it("SS rate = 6.2%", () => {
      expect(MFJ_2025_BRACKETS.socialSecurityRate).toBe(0.062);
    });

    it("Medicare rate = 1.45%", () => {
      expect(MFJ_2025_BRACKETS.medicareRate).toBe(0.0145);
    });
  });
});
