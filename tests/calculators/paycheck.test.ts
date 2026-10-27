import { describe, it, expect } from "vitest";
import {
  calculatePaycheck,
  calculateBlendedAnnual,
  mapSalaryTimelineToPeriods,
  countPeriodsElapsed,
  contribRemainingFraction,
  contribStepFraction,
  monthsDoneYtd,
  monthsElapsedYtd,
  periodsElapsedYtd,
  getExtraPaycheckMonthKeys,
  withheldThroughPeriod,
  periodsBeforeStart,
  checksPaidYtd,
  type SalarySegment,
} from "@/lib/calculators/paycheck";
import type {
  ContributionAccountInput,
  PaycheckInput,
  PaycheckResult,
} from "@/lib/calculators/types";
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

    it("does not deduct 401k from bonus when no account is taken from bonus checks", () => {
      // Bonus: $110,000 × 15% = $16,500
      // No 401k deducted from bonus (every account fromBonus: false)
      const bonusNet = result.bonusEstimate.bonusNet;
      const bonusGross = result.bonusEstimate.bonusGross;
      const fedWH = result.bonusEstimate.bonusFederalWithholding;
      const fica = result.bonusEstimate.bonusFica;
      // Net = gross - fed - fica (no contributions deducted)
      expect(bonusNet).toBeCloseTo(bonusGross - fedWH - fica, 0);
    });
  });

  describe("payFrequencyLabel", () => {
    // paycheck.ts's local label map is consolidated onto
    // display-labels.ts's PAY_PERIOD_LABELS — semimonthly's
    // "(1st & 15th)" suffix and biweekly's even/odd suffix are paycheck-specific
    // detail not present in the shared base labels, preserved here explicitly.
    it("weekly", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        payPeriod: "weekly",
        payWeek: "na",
      });
      expect(result.payFrequencyLabel).toBe("Weekly");
    });

    it("monthly", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        payPeriod: "monthly",
        payWeek: "na",
      });
      expect(result.payFrequencyLabel).toBe("Monthly");
    });

    it("semimonthly", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        payPeriod: "semimonthly",
        payWeek: "na",
      });
      expect(result.payFrequencyLabel).toBe("Semi-Monthly (1st & 15th)");
    });

    it("biweekly even weeks", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        payPeriod: "biweekly",
        payWeek: "even",
      });
      expect(result.payFrequencyLabel).toBe("Biweekly (Even Weeks)");
    });

    it("biweekly odd weeks", () => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        payPeriod: "biweekly",
        payWeek: "odd",
      });
      expect(result.payFrequencyLabel).toBe("Biweekly (Odd Weeks)");
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

  describe("FICA wages", () => {
    const hsa = (
      perPeriod: number,
      cap: number | null,
      extra: Partial<ContributionAccountInput> = {},
    ): ContributionAccountInput => ({
      name: "HSA",
      annualContribution: perPeriod * 26,
      perPeriodContribution: perPeriod,
      rateOfGross: null,
      taxTreatment: "hsa",
      isPayrollDeducted: true,
      fromBonus: false,
      group: "portfolio",
      employerMatch: 0,
      employerMatchTaxTreatment: "pre_tax",
      ficaExemptAnnualCap: cap,
      ...extra,
    });
    const base: PaycheckInput = {
      ...PERSON_A_PAYCHECK_INPUT,
      annualSalary: 104_000,
      deductions: [],
      contributionAccounts: [],
      bonusPercent: 0,
    };
    const gross = 104_000 / 26;
    const { socialSecurityRate: ssRate, medicareRate: medRate } =
      base.taxBrackets;

    it("payroll HSA money isn't FICA wages", () => {
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [hsa(200, Infinity)],
      });
      expect(r.ficaWages).toBeCloseTo(gross - 200, 2);
      expect(r.ficaSS).toBeCloseTo((gross - 200) * ssRate, 2);
      expect(r.ficaMedicare).toBeCloseTo((gross - 200) * medRate, 2);
    });

    it("a contribution whose account type is FICA wages (cap null) stays in", () => {
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [hsa(200, null)],
      });
      expect(r.ficaWages).toBeCloseTo(gross, 2);
    });

    it("a non-payroll contribution doesn't lower FICA wages", () => {
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [
          hsa(200, Infinity, { isPayrollDeducted: false }),
        ],
      });
      expect(r.ficaWages).toBeCloseTo(gross, 2);
    });

    it("only the part within the yearly cap is exempt", () => {
      // Cap $2,600/yr = $100 per check; $200 contributed per check.
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [hsa(200, 2600)],
      });
      expect(r.ficaWages).toBeCloseTo(gross - 100, 2);
    });

    it("an after-tax deduction flagged FICA-exempt is still FICA wages", () => {
      const r = calculatePaycheck({
        ...base,
        deductions: [
          {
            name: "Bad row",
            amount: 50,
            taxTreatment: "after_tax",
            ficaExempt: true,
          },
          {
            name: "Medical",
            amount: 30,
            taxTreatment: "pre_tax",
            ficaExempt: true,
          },
        ],
      });
      expect(r.ficaWages).toBeCloseTo(gross - 30, 2);
    });

    it("an after-tax row on an HSA isn't FICA-exempt (read-time rule, like deductions)", () => {
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [
          hsa(200, Infinity, { taxTreatment: "after_tax" }),
        ],
      });
      expect(r.ficaWages).toBeCloseTo(gross, 2);
    });

    it("YTD withheld comes from the year schedule — full SS until the base, not the average", () => {
      const wageBase = base.taxBrackets.socialSecurityWageBase;
      const r = calculatePaycheck({ ...base, annualSalary: wageBase * 1.5 });
      const first10 = withheldThroughPeriod(r.yearSchedule, 10);
      // Ten full-rate checks, well before the base is reached.
      expect(first10.fica).toBeCloseTo(
        10 * r.ficaWages * (ssRate + medRate),
        0,
      );
      expect(first10.fica).toBeGreaterThan(10 * (r.ficaSS + r.ficaMedicare));
    });

    it("over the wage base, per-check SS is the year's SS averaged over the checks", () => {
      const wageBase = base.taxBrackets.socialSecurityWageBase;
      const r = calculatePaycheck({ ...base, annualSalary: wageBase * 1.5 });
      expect(r.ficaSS).toBeCloseTo((wageBase * ssRate) / 26, 2);
      expect(r.warnings.some((w) => w.includes("Social Security stops"))).toBe(
        true,
      );
      // The year schedule pays the same total, front-loaded.
      const scheduleSS = r.yearSchedule.reduce((s, p) => s + p.ficaSS, 0);
      expect(scheduleSS).toBeCloseTo(wageBase * ssRate, 0);
    });

    it("bonus SS room is what the year's regular FICA wages leave", () => {
      const wageBase = base.taxBrackets.socialSecurityWageBase;
      // Regular gross just under the wage base; the HSA brings FICA wages
      // $5,200 lower, which leaves that much more room for the bonus.
      const salary = wageBase - 1000;
      const r = calculatePaycheck({
        ...base,
        annualSalary: salary,
        contributionAccounts: [hsa(200, Infinity)],
        bonusOverride: 20_000,
      });
      const regularFicaWages = r.ficaWages * 26;
      const ssTaxable = Math.min(20_000, wageBase - regularFicaWages);
      expect(r.bonusEstimate.bonusFicaWages).toBe(20_000);
      expect(r.bonusEstimate.bonusFica).toBeCloseTo(
        ssTaxable * ssRate + 20_000 * medRate,
        1,
      );
    });

    it("an HSA contribution the bonus check takes is exempt only within the cap left", () => {
      // Percent-of-pay HSA at 2%: $80/check and $400 of a $20,000 bonus.
      const pct = hsa(80, 26 * 80 + 150, { rateOfGross: 0.02 });
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [{ ...pct, fromBonus: true }],
        bonusOverride: 20_000,
      });
      // Regular checks use 26 × $80 of the cap; $150 is left for the bonus.
      expect(r.bonusEstimate.bonusFicaWages).toBeCloseTo(20_000 - 150, 2);
    });

    it("the bonus period in the year schedule uses the bonus's FICA wages", () => {
      const r = calculatePaycheck({
        ...base,
        contributionAccounts: [
          hsa(80, Infinity, { rateOfGross: 0.02, fromBonus: true }),
        ],
        bonusOverride: 20_000,
        bonusMonth: 3,
      });
      expect(r.bonusEstimate.bonusFicaWages).toBeCloseTo(20_000 - 400, 2);
      // Well under the wage base: the bonus period's FICA is full-rate on
      // the bonus's FICA wages, not on the bonus gross.
      const bonusPeriod = r.yearSchedule.find((p) => p.bonusGross > 0);
      expect(bonusPeriod?.bonusFica).toBeCloseTo(
        r.bonusEstimate.bonusFicaWages * (ssRate + medRate),
        1,
      );
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
    ficaWages: gross,
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
// Anchor-payday date-walk pinned values
//
// Pinned ahead of consolidating the "align anchor date to on/after a
// reference date" idiom, duplicated across findExtraPaycheckMonths,
// countPeriodsElapsed (2 branches), getExtraPaycheckMonthKeys, and
// findBonusPeriod. findNextPayDate uses a different (exclusive) boundary
// and is deliberately NOT included in that consolidation — pinned here too
// so any accidental behavior merge would be caught.
// ---------------------------------------------------------------------------

describe("anchor-payday date-walk (pinned)", () => {
  it("extraPaycheckMonths — Person A (anchor 2025-01-03)", () => {
    const result = calculatePaycheck(PERSON_A_PAYCHECK_INPUT);
    expect(result.extraPaycheckMonths).toEqual(["January", "August"]);
  });

  it("extraPaycheckMonths — Person B (anchor 2025-01-10)", () => {
    const result = calculatePaycheck(PERSON_B_PAYCHECK_INPUT);
    expect(result.extraPaycheckMonths).toEqual(["May", "October"]);
  });

  it("nextPayDate — biweekly (Person A)", () => {
    expect(calculatePaycheck(PERSON_A_PAYCHECK_INPUT).nextPayDate).toBe(
      "2025-03-14",
    );
  });

  it("nextPayDate — biweekly (Person B)", () => {
    expect(calculatePaycheck(PERSON_B_PAYCHECK_INPUT).nextPayDate).toBe(
      "2025-03-21",
    );
  });

  it("nextPayDate — weekly", () => {
    const result = calculatePaycheck({
      ...PERSON_A_PAYCHECK_INPUT,
      payPeriod: "weekly",
      anchorPayDate: new Date("2025-01-03"),
    });
    expect(result.nextPayDate).toBe("2025-03-14");
  });

  it("nextPayDate — semimonthly", () => {
    const result = calculatePaycheck({
      ...PERSON_A_PAYCHECK_INPUT,
      payPeriod: "semimonthly",
    });
    expect(result.nextPayDate).toBe("2025-03-15");
  });

  it("countPeriodsElapsed — biweekly, mid-year and year-end", () => {
    expect(
      countPeriodsElapsed(
        new Date("2025-03-07"),
        "biweekly",
        new Date("2025-01-03"),
      ),
    ).toBe(5);
    expect(
      countPeriodsElapsed(
        new Date("2025-12-31"),
        "biweekly",
        new Date("2025-01-03"),
      ),
    ).toBe(26);
  });

  it("countPeriodsElapsed — weekly, mid-year and year-end", () => {
    expect(
      countPeriodsElapsed(
        new Date("2025-03-07"),
        "weekly",
        new Date("2025-01-03"),
      ),
    ).toBe(10);
    expect(
      countPeriodsElapsed(
        new Date("2025-12-31"),
        "weekly",
        new Date("2025-01-03"),
      ),
    ).toBe(52);
  });

  it("countPeriodsElapsed — semimonthly", () => {
    expect(
      countPeriodsElapsed(
        new Date("2025-03-07"),
        "semimonthly",
        new Date("2025-01-03"),
      ),
    ).toBe(5);
  });

  it("getExtraPaycheckMonthKeys — 18 month horizon spans a year boundary", () => {
    expect(
      getExtraPaycheckMonthKeys(
        new Date("2025-01-03"),
        "biweekly",
        new Date("2025-03-07"),
        18,
      ),
    ).toEqual(["2025-08-01", "2026-01-01", "2026-07-01"]);
  });

  it.each([
    [1, 15, 1],
    [3, 15, 6],
    [6, 15, 12],
    [12, 15, 25],
    [1, null, 1],
    [3, null, 6],
    [6, null, 12],
    [12, null, 25],
  ])(
    "bonusPeriod — biweekly bonusMonth=%s day=%s",
    (bonusMonth, bonusDayOfMonth, expected) => {
      const result = calculatePaycheck({
        ...PERSON_A_PAYCHECK_INPUT,
        bonusMonth,
        bonusDayOfMonth,
      });
      expect(result.bonusPeriod).toBe(expected);
    },
  );

  it("bonusPeriod — semimonthly, day before/after the 16th split", () => {
    const base = {
      ...PERSON_A_PAYCHECK_INPUT,
      payPeriod: "semimonthly" as const,
      bonusMonth: 6,
    };
    expect(
      calculatePaycheck({ ...base, bonusDayOfMonth: 20 }).bonusPeriod,
    ).toBe(12);
    expect(
      calculatePaycheck({ ...base, bonusDayOfMonth: 10 }).bonusPeriod,
    ).toBe(11);
  });

  it("bonusPeriod — monthly", () => {
    const result = calculatePaycheck({
      ...PERSON_A_PAYCHECK_INPUT,
      payPeriod: "monthly",
      bonusMonth: 6,
      bonusDayOfMonth: null,
    });
    expect(result.bonusPeriod).toBe(6);
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

describe("contribution schedule helpers", () => {
  it("walks paychecks from the anchor payday, else estimates from the month", () => {
    const asOf = new Date(Date.UTC(2026, 9, 12));
    expect(periodsElapsedYtd(asOf, "biweekly", "2026-01-02", 26)).toBe(
      countPeriodsElapsed(asOf, "biweekly", new Date("2026-01-02")),
    );
    expect(periodsElapsedYtd(asOf, "biweekly", null, 26)).toBe(
      Math.round((asOf.getMonth() / 12) * 26),
    );
  });

  it("counts a month from the 15th", () => {
    expect(monthsElapsedYtd(new Date(2026, 9, 14))).toBe(9);
    expect(monthsElapsedYtd(new Date(2026, 9, 15))).toBe(10);
  });

  it("gives what's still to come and one contribution's share, by method", () => {
    const p = { periodsElapsed: 20, periodsPerYear: 26, monthsElapsed: 9 };
    expect(contribRemainingFraction("percent_of_salary", p)).toBeCloseTo(
      6 / 26,
    );
    expect(contribRemainingFraction("fixed_monthly", p)).toBeCloseTo(3 / 12);
    expect(contribRemainingFraction("fixed_annual", p)).toBe(0);
    expect(contribStepFraction("fixed_per_period", 24)).toBeCloseTo(1 / 24);
    expect(contribStepFraction("fixed_monthly", 26)).toBeCloseTo(1 / 12);
    expect(contribStepFraction("fixed_annual", 26)).toBe(0);
  });
});

describe("monthsDoneYtd", () => {
  it("counts a month as done once its contribution has arrived, even before the 15th", () => {
    const oct12 = new Date(2026, 9, 12);
    expect(monthsDoneYtd(oct12, null)).toBe(9);
    expect(monthsDoneYtd(oct12, "2026-10-02")).toBe(10);
    expect(monthsDoneYtd(oct12, "2026-09-02")).toBe(9);
    expect(monthsDoneYtd(oct12, "2025-12-02")).toBe(9); // last year's
  });
});

describe("a job started this year", () => {
  // Biweekly Fridays from 2025-01-03; the job starts Monday 2025-06-02, so
  // the eleven paydays Jan 3 – May 23 aren't its checks; Jun 6 is the first.
  const input: PaycheckInput = {
    ...PERSON_A_PAYCHECK_INPUT,
    annualSalary: 300_000,
    asOfDate: new Date("2025-08-01"),
    startDate: new Date("2025-06-02"),
  };

  it("counts this year's paydays before the start", () => {
    expect(
      periodsBeforeStart(
        input.asOfDate,
        "biweekly",
        input.anchorPayDate,
        input.startDate,
      ),
    ).toBe(11);
    // Started before this year, or no start date: paid all year.
    expect(
      periodsBeforeStart(
        input.asOfDate,
        "biweekly",
        input.anchorPayDate,
        "2024-03-01",
      ),
    ).toBe(0);
    expect(
      periodsBeforeStart(input.asOfDate, "biweekly", input.anchorPayDate, null),
    ).toBe(0);
    expect(
      checksPaidYtd(
        input.asOfDate,
        "biweekly",
        input.anchorPayDate,
        26,
        input.startDate,
      ),
    ).toBe(5);
  });

  it("the paydays before the start are empty; Social Security counts from the first check", () => {
    const r = calculatePaycheck(input);
    const full = calculatePaycheck({ ...input, startDate: null });
    expect(r.periodsBeforeStart).toBe(11);
    expect(r.yearSchedule).toHaveLength(26);
    expect(r.yearSchedule.slice(0, 11).every((p) => p.beforeStart)).toBe(true);
    expect(r.yearSchedule[10]!.gross).toBe(0);
    expect(r.yearSchedule[11]!.beforeStart).toBeUndefined();
    // A full year hits the wage base partway; fifteen checks never do.
    const capAt = (x: PaycheckResult) =>
      x.yearSchedule.findIndex((p) => !p.beforeStart && p.ficaSS === 0);
    expect(capAt(full)).toBeGreaterThan(0);
    expect(capAt(r)).toBe(-1);
    // Same regular check otherwise.
    expect(r.gross).toBe(full.gross);
  });

  it("a bonus dated before the start isn't this job's", () => {
    const r = calculatePaycheck({
      ...input,
      bonusOverride: 10_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    });
    expect(r.bonusPeriod).toBeNull();
    expect(r.yearSchedule.every((p) => p.bonusGross === 0)).toBe(true);
    const later = calculatePaycheck({
      ...input,
      bonusOverride: 10_000,
      bonusMonth: 12,
      bonusDayOfMonth: 15,
    });
    expect(later.bonusPeriod).toBeGreaterThan(11);
  });

  it("no anchor payday: the start date is one, as the paycheck uses", () => {
    // Every other Friday from Jun 6: five checks through Aug 1.
    expect(
      checksPaidYtd(input.asOfDate, "biweekly", null, 26, "2025-06-06"),
    ).toBe(5);
  });

  it("withheld so far is the checks this job paid", () => {
    const r = calculatePaycheck(input);
    const sofar = withheldThroughPeriod(r.yearSchedule, r.periodsElapsedYtd);
    expect(sofar.federal).toBeCloseTo(5 * r.federalWithholding, 0);
  });
});
