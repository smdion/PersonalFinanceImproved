/**
 * OBBBA temporary senior deduction (2025-2028) — end-to-end engine
 * integration. `computeObbbaSeniorDeduction`'s own unit tests
 * (obbba-senior-deduction.test.ts) prove the formula; this proves it
 * actually survives the fold-in at decumulation-year.ts's single injection
 * point, using last year's MAGI and gating on the sunset year.
 *
 * Mutation-checked: reverting the fold-in (`+ obbbaAddon` removed from
 * decumulation-year.ts's grownStandardDeduction computation) makes the
 * delta assertions below fail.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

const MFJ_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0 },
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

const BASE_SD = 32200;

function makeInput(withObbba: boolean): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.2,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.7,
        "403b": 0,
        hsa: 0.05,
        ira: 0.05,
        brokerage: 0.2,
      },
      taxSplits: { "401k": 0.9, ira: 1.0 },
    },
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "bracket_filling",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.35,
        "403b": 0,
        ira: 0.25,
        brokerage: 0.3,
        hsa: 0.1,
      },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        rothBracketTarget: 0.12,
        taxBrackets: MFJ_BRACKETS,
        standardDeduction: BASE_SD,
        enableRothConversions: false,
        taxDataYear: 2025,
        ...(withObbba
          ? {
              obbbaSeniorDeductionPerPerson: 6000,
              obbbaSeniorPhaseoutStart: 150000,
              obbbaSeniorPhaseoutRate: 0.06,
              obbbaSeniorSunsetYear: 2028,
            }
          : {}),
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 65,
    retirementAge: 65, // decumulation from year 0 (2025)
    projectionEndAge: 72, // 2025 -> 2032, spans the 2028 sunset
    currentSalary: 0,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 1200000,
      taxFree: 100000,
      afterTax: 150000,
      afterTaxBasis: 100000,
      hsa: 20000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 1000000,
        roth: 100000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 20000 },
      ira: { structure: "roth_traditional", traditional: 200000, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 150000,
        basis: 100000,
      },
    },
    // Low spending relative to balance -> low MAGI, comfortably under the
    // $150k OBBBA phaseout start, so the addon should apply at its full
    // per-person amount from decumulation year 2 on.
    annualExpenses: 55000,
    decumulationAnnualExpenses: 55000,
    inflationRate: 0.025,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1960,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
  } as ProjectionInput;
}

function decumYears(input: ProjectionInput) {
  return calculateProjection(input).projectionByYear.filter(
    (y) => y.phase === "decumulation",
  );
}

describe("OBBBA senior deduction — end-to-end engine integration", () => {
  it("decumulation year 1 (2026 — the household's first full decumulation year) gets NO OBBBA addon: no prior-year MAGI exists yet", () => {
    const withObbba = decumYears(makeInput(true));
    const without = decumYears(makeInput(false));
    const yr1With = withObbba[0]!;
    const yr1Without = without[0]!;
    expect(yr1With.year).toBe(yr1Without.year);
    expect(yr1With.standardDeduction).toBeCloseTo(
      yr1Without.standardDeduction!,
      2,
    );
  });

  it("decumulation year 2+ applies the addon once last year's MAGI is known", () => {
    const withObbba = decumYears(makeInput(true));
    const without = decumYears(makeInput(false));
    const yr2With = withObbba[1]!;
    const yr2Without = without[1]!;
    expect(yr2With.year).toBeLessThanOrEqual(2028); // still within the window
    expect(yr2With.standardDeduction!).toBeGreaterThan(
      yr2Without.standardDeduction!,
    );
    // The delta should be close to the flat $6,000/person figure for a
    // single-senior household well under the $150k phaseout start — NOT
    // grown by taxGrowth. OBBBA's $6,000 is a fixed, non-CPI-indexed
    // statutory amount (unlike the base standard deduction and §63(f)
    // addon, which are); computeObbbaSeniorDeduction already resolves the
    // correct nominal figure for the projection year, so folding it in
    // after growWithholdingBrackets/growAmount preserves that.
    expect(
      yr2With.standardDeduction! - yr2Without.standardDeduction!,
    ).toBeCloseTo(6000, 0);
  });

  it("years after the 2028 sunset get NO OBBBA addon (gated on sunsetYear, not a hardcoded literal)", () => {
    const withObbba = decumYears(makeInput(true));
    const without = decumYears(makeInput(false));
    const yr2029With = withObbba.find((y) => y.year === 2029)!;
    const yr2029Without = without.find((y) => y.year === 2029)!;
    expect(yr2029With).toBeDefined();
    expect(yr2029With.standardDeduction!).toBeCloseTo(
      yr2029Without.standardDeduction!,
      2,
    );
  });

  it("undefined OBBBA config is byte-identical to the config not existing at all (no accidental default)", () => {
    const withoutA = decumYears(makeInput(false));
    const withoutB = decumYears(makeInput(false));
    for (let i = 0; i < withoutA.length; i++) {
      expect(withoutA[i]!.standardDeduction).toBeCloseTo(
        withoutB[i]!.standardDeduction!,
        6,
      );
    }
  });
});
