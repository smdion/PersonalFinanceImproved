import { describe, it, expect } from "vitest";
import { calculateTax } from "@/lib/calculators/tax";
import {
  MFJ_NO_CHECKBOX_BRACKETS,
  MFJ_2C_BRACKETS,
  AS_OF_DATE,
} from "./fixtures";
import type { TaxInput } from "@/lib/calculators/types";

describe("calculateTax", () => {
  describe("household combined income (MFJ, no checkbox)", () => {
    // Combined: Person A $120,000 + Person B $110,000 = $230,000
    // Pre-tax annual deductions:
    //   Person A: STD $30 + LTD $22 = $52/period × 26 = $1,352
    //   Person B: dental $8 + medical $140 + vision $5 = $153/period × 26 = $3,978
    //   Person B: Trad 401k = $676.92 × 26 = $17,600
    //   Person B: HSA = $321 × 26 = $8,346
    //   Total pre-tax annual ≈ $31,276
    const input: TaxInput = {
      annualGross: 230000,
      preTaxDeductionsAnnual: 31276,
      filingStatus: "MFJ",
      taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    };
    const result = calculateTax(input);

    it("computes taxable income after standard deduction", () => {
      // AGI = 230000 - 31276 = 198724
      // Taxable = 198724 - 30000 = 168724
      expect(result.taxableIncome).toBeCloseTo(168724, 0);
    });

    it("computes marginal rate of 22%", () => {
      // $168,724 falls in the 22% bracket (120100-230700 for MFJ no checkbox)
      expect(result.marginalRate).toBe(0.22);
    });

    it("computes federal tax", () => {
      // Walk brackets: 0-19300=0, 19300-44100 @10%=2480, 44100-120100 @12%=9120,
      // 120100-168724 @22%=10697.28
      // Total ≈ 22297
      expect(result.federalTax).toBeCloseTo(22297, 0);
    });

    it("computes effective rate", () => {
      expect(result.effectiveRate).toBeGreaterThan(0.15);
      expect(result.effectiveRate).toBeLessThan(0.25);
    });

    it("computes FICA Social Security capped at wage base", () => {
      // SS on gross up to $176,100 cap
      // Since $230,000 > $176,100, SS = $176,100 × 0.062 = $10,918.20
      expect(result.ficaSS).toBe(10918.2);
    });

    it("computes FICA Medicare with additional tax", () => {
      // Base: $230,000 × 0.0145 = $3,335
      // Additional: ($230,000 - $200,000) × 0.009 = $270
      // Total ≈ $3,605
      expect(result.ficaMedicare).toBeCloseTo(3605, 0);
    });
  });

  describe("W-4 2(c) checkbox override", () => {
    const baseInput: TaxInput = {
      annualGross: 120000,
      preTaxDeductionsAnnual: 1352,
      filingStatus: "MFJ",
      taxBrackets: MFJ_2C_BRACKETS,
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    };

    it("auto-detects from bracket set when override is null", () => {
      const result = calculateTax(baseInput);
      expect(result.w4CheckboxUsed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("adds warning when user explicitly overrides", () => {
      const result = calculateTax({ ...baseInput, w4CheckboxOverride: true });
      expect(result.w4CheckboxUsed).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining("W-4 Step 2(c) checkbox manually enabled"),
      );
    });

    it("shows disabled message when override is false", () => {
      const result = calculateTax({ ...baseInput, w4CheckboxOverride: false });
      expect(result.w4CheckboxUsed).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining("manually disabled"),
      );
    });
  });

  describe("zero income edge case", () => {
    it("returns zero tax for zero income", () => {
      const result = calculateTax({
        annualGross: 0,
        preTaxDeductionsAnnual: 0,
        filingStatus: "MFJ",
        taxBrackets: MFJ_NO_CHECKBOX_BRACKETS,
        w4CheckboxOverride: null,
        asOfDate: AS_OF_DATE,
      });
      expect(result.federalTax).toBe(0);
      expect(result.ficaSS).toBe(0);
      expect(result.ficaMedicare).toBe(0);
      expect(result.totalTax).toBe(0);
      expect(result.effectiveRate).toBe(0);
    });
  });
});
