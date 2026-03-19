import { describe, it, expect } from "vitest";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
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
});
