/**
 * R59 (v0.7.11): the IRC §63(f)(1) age-65+ additional standard deduction is
 * now modeled in the decumulation phase. `decumulation-year.ts` folds
 * `additionalStdDeduction65PerSenior × (count of household members 65+ that
 * projection year)` into the standard deduction BEFORE the per-year inflation
 * growth, so it grows on the same tax-data vintage as the base deduction.
 *
 * Before this, `toLtcgTaxableIncome` and every ordinary-bracket call site saw
 * only the flat filing-status deduction, systematically understating 0%-LTCG
 * room and overstating ordinary tax for the ~always-65+ decumulation
 * population.
 *
 * Runs the REAL engine end-to-end (a unit test of the helper can't prove the
 * value survives the five splice points in decumulation-year.ts). Mutation-
 * checked: reverting the fold in decumulation-year.ts makes the delta
 * assertions below fail.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

// Flat MFJ withholding brackets (first threshold is the SD-embedded 0% band,
// same shape build-engine-payload feeds the engine).
const MFJ_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0 },
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

const BASE_SD = 32200;
const PER_SENIOR = 1650; // 2026 MFJ per-spouse §63(f) amount

function makeInput(overrides: {
  additionalStdDeduction65PerSenior?: number;
  perPersonBirthYears?: number[];
  currentAge?: number;
  retirementAge?: number;
}): ProjectionInput {
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
        additionalStdDeduction65PerSenior:
          overrides.additionalStdDeduction65PerSenior,
        enableRothConversions: false,
        taxDataYear: 2026,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: overrides.currentAge ?? 63,
    retirementAge: overrides.retirementAge ?? 63,
    projectionEndAge: 80,
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
      preTax: 1600000,
      taxFree: 80000,
      afterTax: 150000,
      afterTaxBasis: 100000,
      hsa: 20000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 1400000,
        roth: 80000,
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
    annualExpenses: 90000,
    decumulationAnnualExpenses: 90000,
    inflationRate: 0.03,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1962,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
    perPersonBirthYears: overrides.perPersonBirthYears,
  } as ProjectionInput;
}

function decumYears(input: ProjectionInput) {
  return calculateProjection(input).projectionByYear.filter(
    (y) => y.phase === "decumulation",
  );
}

describe("R59 — age-65+ additional standard deduction (decumulation)", () => {
  it("adds one per-senior increment (grown) for a single-senior household, only from age 65 on", () => {
    const withAddon = decumYears(
      makeInput({ additionalStdDeduction65PerSenior: PER_SENIOR }),
    );
    const without = decumYears(
      makeInput({ additionalStdDeduction65PerSenior: undefined }),
    );

    // The projection starts at age 63 (birthYear 1962, AS_OF 2025).
    const yr64 = withAddon.find((y) => y.age === 64)!;
    const base64 = without.find((y) => y.age === 64)!;
    const yr66 = withAddon.find((y) => y.age === 66)!;
    const base66 = without.find((y) => y.age === 66)!;

    expect(yr64).toBeDefined();
    expect(yr66).toBeDefined();

    // Under 65: no change at all.
    expect(yr64.standardDeduction).toBeCloseTo(base64.standardDeduction!, 2);

    // 65+: exactly one per-senior increment, grown by the SAME factor the
    // base deduction was grown by that year (perPersonBirthYears unset ⇒
    // the age-based single-senior fallback).
    const grownFactor = base66.standardDeduction! / BASE_SD;
    expect(yr66.standardDeduction! - base66.standardDeduction!).toBeCloseTo(
      PER_SENIOR * grownFactor,
      2,
    );
  });

  it("scales by the number of household members 65+ that year (perPersonBirthYears)", () => {
    // Two people: born 1958 (67 at AS_OF) and 1963 (62 at AS_OF). In the
    // projection year the younger turns 65, the count goes 1 → 2.
    const input = makeInput({
      additionalStdDeduction65PerSenior: PER_SENIOR,
      perPersonBirthYears: [1958, 1963],
    });
    const withAddon = decumYears(input);
    const without = decumYears(
      makeInput({ perPersonBirthYears: [1958, 1963] }),
    );

    for (const y of withAddon) {
      const b = without.find((w) => w.year === y.year)!;
      const seniors = [1958, 1963].filter((by) => y.year - by >= 65).length;
      const grownFactor = b.standardDeduction! / BASE_SD;
      expect(y.standardDeduction! - b.standardDeduction!).toBeCloseTo(
        seniors * PER_SENIOR * grownFactor,
        2,
      );
    }
    // Sanity: the fixture actually exercises both a 1-senior and a 2-senior year.
    const counts = new Set(
      withAddon.map(
        (y) => [1958, 1963].filter((by) => y.year - by >= 65).length,
      ),
    );
    expect(counts.has(1)).toBe(true);
    expect(counts.has(2)).toBe(true);
  });

  it("a larger standard deduction lowers ordinary tax / raises bracket room in 65+ years", () => {
    const withAddon = decumYears(
      makeInput({ additionalStdDeduction65PerSenior: PER_SENIOR }),
    );
    const without = decumYears(
      makeInput({ additionalStdDeduction65PerSenior: undefined }),
    );
    const y = withAddon.find((v) => v.age === 70)!;
    const b = without.find((v) => v.age === 70)!;
    // More deduction ⇒ the Traditional bracket-fill ceiling (gross-income
    // terms) is at least as high, and it's strictly higher here.
    expect(y.bracketTraditionalCap!).toBeGreaterThan(b.bracketTraditionalCap!);
  });

  it("undefined additionalStdDeduction65PerSenior is byte-identical to pre-R59 (no accidental default)", () => {
    const a = decumYears(
      makeInput({ additionalStdDeduction65PerSenior: undefined }),
    );
    const b = decumYears(makeInput({ additionalStdDeduction65PerSenior: 0 }));
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.standardDeduction).toBeCloseTo(b[i]!.standardDeduction!, 6);
      expect(a[i]!.taxCost).toBeCloseTo(b[i]!.taxCost, 6);
    }
  });
});
