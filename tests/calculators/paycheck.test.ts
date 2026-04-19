import { describe, it, expect } from "vitest";
import {
  calculatePaycheck,
  calculateBlendedAnnual,
  mapSalaryTimelineToPeriods,
  type SalarySegment,
} from "@/lib/calculators/paycheck";
import type { PaycheckResult } from "@/lib/calculators/types";
import { PERSON_A_PAYCHECK_INPUT, PERSON_B_PAYCHECK_INPUT } from "./fixtures";

describe("calculatePaycheck", () => {
  describe("Person A — biweekly paycheck", () => {
    const result = calculatePaycheck(PERSON_A_PAYCHECK_INPUT);

    it("computes correct gross pay", () => {
      // $120,000 / 26 periods = $4,615.38
      expect(result.gross).toBeCloseTo(4615.38, 0);
    });

    it("computes correct federal withholding", () => {
      expect(result.federalWithholding).toBeGreaterThan(600);
      expect(result.federalWithholding).toBeLessThan(700);
    });

    it("computes correct FICA Social Security", () => {
      // FICA base = gross - FICA-exempt (STD $30 + LTD $22) = $4,563.38
      // SS = $4,563.38 × 0.062 ≈ $282.93
      expect(result.ficaSS).toBeCloseTo(282.93, 0);
    });

    it("computes correct FICA Medicare", () => {
      // $4,563.38 × 0.0145 ≈ $66.17
      expect(result.ficaMedicare).toBeCloseTo(66.17, 0);
    });

    it("computes correct net pay", () => {
      expect(result.netPay).toBeGreaterThan(2800);
      expect(result.netPay).toBeLessThan(3100);
    });

    it("separates pre-tax and post-tax deductions correctly", () => {
      // Pre-tax: STD + LTD = 2 items
      expect(result.preTaxDeductions).toHaveLength(2);
      // Post-tax: Roth 401k (payroll-deducted) = 1 item
      expect(result.postTaxDeductions).toHaveLength(1);
      expect(result.postTaxDeductions[0]?.name).toBe("Roth 401k");
    });

    it("excludes non-payroll contributions from deductions", () => {
      // Roth IRA and Brokerage are NOT payroll-deducted
      const allDeductionNames = [
        ...result.preTaxDeductions.map((d) => d.name),
        ...result.postTaxDeductions.map((d) => d.name),
      ];
      expect(allDeductionNames).not.toContain("Roth IRA");
      expect(allDeductionNames).not.toContain("LT Brokerage");
    });

    it("returns 26 periods per year for biweekly", () => {
      expect(result.periodsPerYear).toBe(26);
    });

    it("generates full year schedule with 26 periods", () => {
      expect(result.yearSchedule).toHaveLength(26);
    });

    it("computes bonus estimate with supplemental rate", () => {
      // Bonus = $120,000 × 10% = $12,000
      expect(result.bonusEstimate.bonusGross).toBeCloseTo(12000, 0);
      // Federal = $12,000 × 22% supplemental rate = $2,640
      expect(result.bonusEstimate.bonusFederalWithholding).toBeCloseTo(2640, 0);
    });
  });

  describe("Person B — biweekly paycheck", () => {
    const result = calculatePaycheck(PERSON_B_PAYCHECK_INPUT);

    it("computes correct gross pay", () => {
      // $110,000 / 26 = $4,230.77
      expect(result.gross).toBeCloseTo(4230.77, 0);
    });

    it("computes correct federal withholding", () => {
      expect(result.federalWithholding).toBeGreaterThan(300);
      expect(result.federalWithholding).toBeLessThan(400);
    });

    it("computes correct FICA Social Security", () => {
      // FICA base = gross - FICA-exempt (dental $8 + medical $140 + vision $5) = $4,077.77
      // SS = $4,077.77 × 0.062 ≈ $252.82
      expect(result.ficaSS).toBeCloseTo(252.82, 0);
    });

    it("computes correct FICA Medicare", () => {
      // $4,077.77 × 0.0145 ≈ $59.13
      expect(result.ficaMedicare).toBeCloseTo(59.13, 0);
    });

    it("computes correct net pay", () => {
      expect(result.netPay).toBeGreaterThan(1700);
      expect(result.netPay).toBeLessThan(2000);
    });

    it("separates pre-tax and post-tax deductions correctly", () => {
      // Pre-tax: dental, medical, vision, trad 401k, HSA = 5
      expect(result.preTaxDeductions).toHaveLength(5);
      // Post-tax: Roth 401k, ESPP = 2
      expect(result.postTaxDeductions).toHaveLength(2);
    });

    it("does not deduct 401k from bonus when includeContribInBonus=false", () => {
      // Bonus: $110,000 × 15% = $16,500
      // No 401k deducted from bonus (includeContribInBonus=false)
      const bonusNet = result.bonusEstimate.bonusNet;
      const bonusGross = result.bonusEstimate.bonusGross;
      const fedWH = result.bonusEstimate.bonusFederalWithholding;
      const fica = result.bonusEstimate.bonusFica;
      // Net = gross - fed - fica (no contributions deducted)
      expect(bonusNet).toBeCloseTo(bonusGross - fedWH - fica, 0);
    });
  });

  describe("bonus override", () => {
    it("uses bonusOverride when set", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        bonusOverride: 15000,
      });
      expect(result.bonusEstimate.bonusGross).toBe(15000);
    });

    it("applies bonusMultiplier when no override", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        bonusMultiplier: 1.5,
        bonusOverride: null,
      });
      // $120,000 × 10% × 1.5 × (12/12) = $18,000
      expect(result.bonusEstimate.bonusGross).toBeCloseTo(18000, 0);
    });

    it("override takes priority over multiplier", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        bonusMultiplier: 2.0,
        bonusOverride: 5000,
      });
      expect(result.bonusEstimate.bonusGross).toBe(5000);
    });
  });

  describe("SS wage base cap in year schedule", () => {
    it("stops SS tax when wage base is exceeded", () => {
      // Use a high salary that would exceed SS wage base ($176,100)
      const highSalaryInput = {
        ...PERSON_A_PAYCHECK_INPUT,
        annualSalary: 250000,
        deductions: [],
        contributionAccounts: [],
      };
      const result = calculatePaycheck(highSalaryInput);

      // Early periods should have SS tax
      expect(result.yearSchedule[0]?.ficaSS).toBeGreaterThan(0);

      // Later periods should have $0 SS (wage base exceeded)
      const lastPeriod = result.yearSchedule[result.yearSchedule.length - 1];
      expect(lastPeriod?.ficaSS).toBe(0);

      // All periods should have Medicare (no cap)
      for (const period of result.yearSchedule) {
        expect(period.ficaMedicare).toBeGreaterThan(0);
      }
    });
  });

  describe("top tax bracket (null max)", () => {
    it("calculates withholding for income above the highest bracket floor", () => {
      // MFJ 2C top bracket starts at $400,450 (max: null). Need salary > $400,450.
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        annualSalary: 600_000,
        deductions: [],
        contributionAccounts: [],
      });
      expect(result.federalWithholding).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// calculateBlendedAnnual
// ---------------------------------------------------------------------------

function makeMinimalPaycheck(gross: number): PaycheckResult {
  return {
    gross,
    federalWithholding: gross * 0.22,
    preTaxDeductions: [],
    postTaxDeductions: [],
    // eslint-disable-next-line no-restricted-syntax -- test-only stub; only fields calculateBlendedAnnual reads
  } as unknown as PaycheckResult;
}

function makeSegment(
  gross: number,
  startPeriod: number,
  endPeriod: number,
): SalarySegment {
  return {
    salary: gross * 26,
    effectiveDate: null,
    startPeriod,
    endPeriod,
    paycheck: makeMinimalPaycheck(gross),
  };
}

const TAX_BRACKETS = {
  socialSecurityWageBase: 176_100,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
};

describe("calculateBlendedAnnual", () => {
  it("returns zero totals for empty segments (early return)", () => {
    const result = calculateBlendedAnnual([], TAX_BRACKETS);
    expect(result.gross).toBe(0);
    expect(result.ficaSS).toBe(0);
    expect(result.ficaMedicare).toBe(0);
  });

  it("computes totals for a full-year single segment", () => {
    // $150k salary: $5,769.23/period × 26 = $150k gross
    const result = calculateBlendedAnnual(
      [makeSegment(5769.23, 1, 26)],
      TAX_BRACKETS,
    );
    expect(result.gross).toBeCloseTo(5769.23 * 26, 0);
    expect(result.ficaSS).toBeGreaterThan(0);
    expect(result.ficaMedicare).toBeGreaterThan(0);
  });

  it("handles SS wage base spanning across periods (lines 986-990)", () => {
    // segFicaBase = $10,000/period, ssWageBase = $176,100
    // Period 17: ytd = 170,000 < 176,100 → full SS
    // Period 18: ytd = 180,000 > 176,100, prev = 170,000 < 176,100 → spanning case
    // Period 19+: prev >= 176,100 → no SS
    const result = calculateBlendedAnnual(
      [makeSegment(10_000, 1, 26)],
      TAX_BRACKETS,
    );
    // SS should be capped at ssWageBase × rate, not 26 × 10000 × rate
    const maxSS =
      TAX_BRACKETS.socialSecurityWageBase * TAX_BRACKETS.socialSecurityRate;
    expect(result.ficaSS).toBeCloseTo(maxSS, 0);
  });
});

// ---------------------------------------------------------------------------
// mapSalaryTimelineToPeriods
// ---------------------------------------------------------------------------

describe("mapSalaryTimelineToPeriods", () => {
  const anchor = new Date("2026-01-02T00:00:00"); // a Friday

  it("returns empty array for empty timeline", () => {
    expect(mapSalaryTimelineToPeriods([], "biweekly", anchor, 2026)).toEqual(
      [],
    );
  });

  it("returns single full-year segment for a one-entry timeline (monthly)", () => {
    const result = mapSalaryTimelineToPeriods(
      [{ salary: 100_000, effectiveDate: null }],
      "monthly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.startPeriod).toBe(1);
    expect(result[0]!.endPeriod).toBe(12);
    expect(result[0]!.salary).toBe(100_000);
  });

  it("returns single full-year segment for a one-entry timeline (semimonthly)", () => {
    const result = mapSalaryTimelineToPeriods(
      [{ salary: 80_000, effectiveDate: null }],
      "semimonthly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.endPeriod).toBe(24);
  });

  it("returns single full-year segment for a one-entry timeline (biweekly)", () => {
    const result = mapSalaryTimelineToPeriods(
      [{ salary: 90_000, effectiveDate: null }],
      "biweekly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.endPeriod).toBe(26);
  });

  it("returns single full-year segment for a one-entry timeline (weekly)", () => {
    const result = mapSalaryTimelineToPeriods(
      [{ salary: 60_000, effectiveDate: null }],
      "weekly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.endPeriod).toBe(52);
  });

  it("splits into two segments when salary changes mid-year (biweekly)", () => {
    const timeline = [
      { salary: 100_000, effectiveDate: null },
      { salary: 120_000, effectiveDate: "2026-07-01" },
    ];
    const result = mapSalaryTimelineToPeriods(
      timeline,
      "biweekly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.salary).toBe(100_000);
    expect(result[1]!.salary).toBe(120_000);
    expect(result[0]!.endPeriod).toBeLessThan(result[1]!.startPeriod);
    expect(result[1]!.endPeriod).toBe(26);
  });

  it("splits into two segments for monthly pay periods", () => {
    const timeline = [
      { salary: 100_000, effectiveDate: null },
      { salary: 110_000, effectiveDate: "2026-07-01" },
    ];
    const result = mapSalaryTimelineToPeriods(
      timeline,
      "monthly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.salary).toBe(100_000);
    expect(result[1]!.salary).toBe(110_000);
    expect(result[0]!.endPeriod + 1).toBe(result[1]!.startPeriod);
  });

  it("splits into two segments for semimonthly pay periods", () => {
    const timeline = [
      { salary: 95_000, effectiveDate: null },
      { salary: 105_000, effectiveDate: "2026-07-01" },
    ];
    const result = mapSalaryTimelineToPeriods(
      timeline,
      "semimonthly",
      anchor,
      2026,
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.startPeriod).toBe(1);
    expect(result[1]!.endPeriod).toBe(24);
  });
});
