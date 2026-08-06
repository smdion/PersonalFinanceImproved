import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateTax } from "@/lib/calculators/tax";
import { roundToCents } from "@/lib/utils/math";
import {
  MFJ_NO_CHECKBOX_BRACKETS,
  MFJ_2C_BRACKETS,
  AS_OF_DATE,
} from "./fixtures";
import type { TaxInput, TaxBracketInput } from "@/lib/calculators/types";

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

// Simplified bracket set for boundary testing.
// standardDeduction: 0 so taxableIncome === annualGross — makes boundary math exact.
// FICA rates zeroed so these tests only exercise the federal bracket walk.
const BOUNDARY_BRACKETS: TaxBracketInput = {
  filingStatus: "Single",
  w4Checkbox: false,
  standardDeduction: 0,
  brackets: [
    { min: 0, max: 10000, rate: 0.1 },
    { min: 10000, max: 40000, rate: 0.12 },
    { min: 40000, max: 100000, rate: 0.22 },
    { min: 100000, max: null, rate: 0.24 },
  ],
  socialSecurityWageBase: 200000,
  socialSecurityRate: 0,
  medicareRate: 0,
  medicareAdditionalRate: 0,
  medicareAdditionalThreshold: 200000,
};

function taxAt(annualGross: number) {
  return calculateTax({
    annualGross,
    preTaxDeductionsAnnual: 0,
    filingStatus: "Single",
    taxBrackets: BOUNDARY_BRACKETS,
    w4CheckboxOverride: null,
    asOfDate: AS_OF_DATE,
  });
}

describe("calculateTax — bracket boundary cases", () => {
  it("zero income produces all-zero result with no NaN", () => {
    const r = taxAt(0);
    expect(r.federalTax).toBe(0);
    expect(r.marginalRate).toBe(0);
    expect(r.effectiveRate).toBe(0);
    expect(isNaN(r.federalTax)).toBe(false);
    expect(isNaN(r.effectiveRate)).toBe(false);
  });

  it("income below standard deduction produces zero tax when deduction exceeds income", () => {
    const r = calculateTax({
      annualGross: 5000,
      preTaxDeductionsAnnual: 0,
      filingStatus: "Single",
      taxBrackets: { ...BOUNDARY_BRACKETS, standardDeduction: 15000 },
      w4CheckboxOverride: null,
      asOfDate: AS_OF_DATE,
    });
    expect(r.federalTax).toBe(0);
    expect(r.taxableIncome).toBe(0);
  });

  it("income at exact bracket boundary is in the lower bracket", () => {
    const r = taxAt(10000);
    expect(r.marginalRate).toBe(0.1);
    expect(r.federalTax).toBe(1000.0); // 10000 * 0.10
  });

  it("income just above bracket boundary crosses into higher bracket", () => {
    // $1 over the boundary: the marginal rate flips to 12% AND the rounded tax
    // visibly reflects the higher bracket (1000.00 -> 1000.12). A sub-cent delta
    // would round back to 1000.00 and silently pass even if the bracket walk broke.
    const r = taxAt(10001);
    expect(r.marginalRate).toBe(0.12);
    expect(r.federalTax).toBe(roundToCents(1000 + 1 * 0.12)); // 1000.12
  });

  it("income at top finite bracket boundary is in the lower rate", () => {
    const r = taxAt(100000);
    expect(r.marginalRate).toBe(0.22);
    expect(r.federalTax).toBe(roundToCents(1000 + 30000 * 0.12 + 60000 * 0.22)); // 17800.00
  });

  it("income just into the open-ended top bracket uses top rate", () => {
    // $1 into the top bracket: 24% marginal rate and a visible tax delta over
    // the finite-bracket boundary (17800.00 -> 17800.24).
    const r = taxAt(100001);
    expect(r.marginalRate).toBe(0.24);
    expect(r.federalTax).toBe(roundToCents(17800 + 1 * 0.24)); // 17800.24
  });

  it("second bracket boundary: $40,000", () => {
    const r = taxAt(40000);
    expect(r.marginalRate).toBe(0.12);
    expect(r.federalTax).toBe(roundToCents(1000 + 30000 * 0.12)); // 4600.00
  });
});

describe("calculateTax — fast-check properties", () => {
  // Run locally with numRuns: 10000 to flush edge cases before committing.
  // CI default (100 runs) is sufficient for regression guarding.

  it("tax is monotone: higher income never produces lower federal tax", () => {
    // Whole-dollar domain: avoids rounding-dominated edge cases at sub-cent values.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }), // $0–$500k
        fc.integer({ min: 1, max: 1_000 }), // $1–$1000 increment
        (income, delta) => {
          const base = taxAt(income);
          const higher = taxAt(income + delta);
          return higher.federalTax >= base.federalTax;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("effective rate never exceeds marginal rate", () => {
    // Whole-dollar domain: at sub-dollar amounts, rounding can push effective > marginal
    // (e.g. $0.15 income at 10% → $0.015 rounds up to $0.02, effective = 13.3%).
    // That's a rounding artifact, not a bracket-walk bug. Whole-dollar inputs avoid it.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }), // $1–$500k
        (income) => {
          const r = taxAt(income);
          return r.effectiveRate <= r.marginalRate + 0.0001; // float tolerance
        },
      ),
      { numRuns: 100 },
    );
  });

  it("federal tax is always non-negative", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (income) => {
        const r = taxAt(income);
        return r.federalTax >= 0;
      }),
      { numRuns: 100 },
    );
  });
});
