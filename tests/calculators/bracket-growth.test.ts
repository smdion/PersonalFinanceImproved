import { describe, it, expect } from "vitest";
import {
  taxGrowthYears,
  taxGrowthFactor,
  growAmount,
  growWithholdingBrackets,
} from "@/lib/calculators/engine/bracket-growth";
import {
  estimateEffectiveTaxRate,
  computeTaxableSS,
} from "@/lib/calculators/engine/tax-estimation";
import { NIIT_THRESHOLDS, computeNiit } from "@/lib/config/niit";
import { TEST_BRACKETS } from "./fixtures/engine-fixtures";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

describe("taxGrowthYears", () => {
  it("is 0 when year equals taxDataYear", () => {
    expect(taxGrowthYears(2026, 2026)).toBe(0);
  });

  it("is 0 (clamped) when year is before taxDataYear", () => {
    expect(taxGrowthYears(2020, 2026)).toBe(0);
  });

  it("grows with the gap between year and taxDataYear", () => {
    expect(taxGrowthYears(2044, 2026)).toBe(18);
  });

  it("is 0 when taxDataYear is undefined — treat as already current", () => {
    expect(taxGrowthYears(2044, undefined)).toBe(0);
  });
});

describe("taxGrowthFactor", () => {
  it("is exactly 1.0 (no-op) at yearIndex 0 — must not change today's numbers", () => {
    expect(taxGrowthFactor(2026, 2026, 0.03)).toBe(1);
  });

  it("compounds by (1+inflationRate)^years", () => {
    expect(taxGrowthFactor(2044, 2026, 0.03)).toBeCloseTo(
      Math.pow(1.03, 18),
      10,
    );
  });

  it("is 1.0 when inflationRate is 0, at any year gap", () => {
    expect(taxGrowthFactor(2066, 2026, 0)).toBe(1);
  });
});

describe("growAmount", () => {
  it("returns undefined when base is undefined — matches existing 'undefined ⇒ omitted' convention", () => {
    expect(growAmount(undefined, 1.5)).toBeUndefined();
  });

  it("is a no-op at growthFactor 1", () => {
    expect(growAmount(32200, 1)).toBe(32200);
  });

  it("scales linearly", () => {
    expect(growAmount(32200, 1.5)).toBeCloseTo(48300, 5);
  });
});

describe("growWithholdingBrackets", () => {
  it("is a no-op at growthFactor 1 — must not change today's numbers", () => {
    expect(growWithholdingBrackets(TEST_BRACKETS, 1)).toEqual(TEST_BRACKETS);
  });

  it("scales both threshold and baseWithholding by the identical factor", () => {
    const grown = growWithholdingBrackets(TEST_BRACKETS, 1.5);
    for (let i = 0; i < TEST_BRACKETS.length; i++) {
      expect(grown[i]!.threshold).toBeCloseTo(
        TEST_BRACKETS[i]!.threshold * 1.5,
        5,
      );
      expect(grown[i]!.baseWithholding).toBeCloseTo(
        TEST_BRACKETS[i]!.baseWithholding * 1.5,
        5,
      );
      expect(grown[i]!.rate).toBe(TEST_BRACKETS[i]!.rate); // rate never scales
    }
  });

  // The specific correctness risk this module's docblock calls out:
  // tax(k·x) = k·tax(x) for a uniformly-scaled schedule. Proven here by
  // actually computing tax at a grown bracket table and confirming it
  // matches k times the tax at the base table — not just asserting the
  // formula, executing it.
  it("preserves tax(k·x) = k·tax(x): tax computed against the grown table at k·income equals k times tax computed against the base table at income", () => {
    const k = 2.5;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    for (const income of [10000, 50000, 100000, 250000, 500000]) {
      const baseTax = estimateEffectiveTaxRate(income, TEST_BRACKETS) * income;
      const grownTax =
        estimateEffectiveTaxRate(income * k, grown) * (income * k);
      expect(grownTax).toBeCloseTo(baseTax * k, 2);
    }
  });

  it("preserves the same identity even with a standardDeduction applied, when the deduction is grown by the SAME factor (the coupling this fix depends on)", () => {
    const k = 1.75;
    const standardDeduction = 32200;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    const grownStandardDeduction = growAmount(standardDeduction, k)!;
    for (const income of [40000, 80000, 150000, 300000]) {
      const baseTax =
        estimateEffectiveTaxRate(income, TEST_BRACKETS, 1, standardDeduction) *
        income;
      const grownTax =
        estimateEffectiveTaxRate(income * k, grown, 1, grownStandardDeduction) *
        (income * k);
      expect(grownTax).toBeCloseTo(baseTax * k, 2);
    }
  });

  it("desyncs (fails the identity) when standardDeduction is NOT grown by the same factor — guards against ever re-introducing this bug", () => {
    const k = 1.75;
    const standardDeduction = 32200;
    const grown = growWithholdingBrackets(TEST_BRACKETS, k);
    const income = 80000;
    const baseTax =
      estimateEffectiveTaxRate(income, TEST_BRACKETS, 1, standardDeduction) *
      income;
    // Deliberately using the UNGROWN standardDeduction against the GROWN
    // brackets -- the mistake this test exists to catch if ever repeated.
    const desyncedTax =
      estimateEffectiveTaxRate(income * k, grown, 1, standardDeduction) *
      (income * k);
    expect(desyncedTax).not.toBeCloseTo(baseTax * k, 2);
  });
});

// Regression guard (advisor review, 2026-08-31, following the reverted
// NIIT mistake earlier this same session): NIIT's MAGI threshold and
// Social Security's provisional-income taxation thresholds are genuinely
// flat NOMINAL by law and must NEVER be grown by this module or anything
// that consumes it. Neither function below takes a year/growth-related
// parameter at all — structurally can't be affected by bracket-growth.ts
// — this test exists so that guarantee stays explicit and visible, not
// just true by omission.
describe("NIIT and Social Security taxation thresholds stay untouched by bracket growth", () => {
  it("NIIT_THRESHOLDS are still the flat nominal law values", () => {
    expect(NIIT_THRESHOLDS.MFJ).toBe(250000);
    expect(NIIT_THRESHOLDS.Single).toBe(200000);
    expect(NIIT_THRESHOLDS.HOH).toBe(200000);
  });

  it("computeNiit takes no year/growth parameter — same result regardless of how far in the future it's called for", () => {
    expect(computeNiit(300000, 80000, "MFJ")).toBe(1900);
  });

  it("computeTaxableSS's signature has no year/growth parameter to accidentally wire growth into", () => {
    expect(computeTaxableSS.length).toBeLessThanOrEqual(4);
    expect(computeTaxableSS(30000, 80000, "MFJ")).toBeGreaterThan(0);
  });
});

// End-to-end wiring regression guard (advisor review, 2026-08-31): every
// UNIT test above exercises the helpers in isolation, and every OTHER
// engine test in this suite leaves `taxDataYear` undefined (growth is a
// no-op for all of them) -- meaning if someone later "cleans up" one of
// the five splice points in decumulation-year.ts back to the raw
// `taxRates` object, the entire rest of the suite stays green and the
// household silently gets pre-fix (frozen-bracket) numbers again. This
// runs the REAL engine end-to-end with taxDataYear set in the past and
// asserts the grown number, the one thing a unit test of the helpers
// alone can't prove.
const AS_OF = new Date("2025-03-07");
const MFJ_BRACKETS = [
  { threshold: 0, baseWithholding: 0, rate: 0 },
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

function makeInput(
  overrides: {
    taxDataYear?: number;
    inflationRate?: number;
  } = {},
): ProjectionInput {
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
        standardDeduction: 32200,
        enableRothConversions: false,
        taxDataYear: overrides.taxDataYear,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 60,
    projectionEndAge: 75,
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
    inflationRate: overrides.inflationRate ?? 0.03,
    returnRates: [{ label: "6%", rate: 0.06 }],
    birthYear: 1965,
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
  } as ProjectionInput;
}

describe("end-to-end: bracketTraditionalCap actually grows through the real engine", () => {
  it("equals the base cap unchanged when taxDataYear is undefined (pre-fix behavior preserved)", () => {
    const result = calculateProjection(makeInput({ taxDataYear: undefined }));
    const firstDecumYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    // rothBracketTarget 0.12 against MFJ_BRACKETS + $32,200 SD, ungrown:
    // incomeCapForMarginalRate(0.12) finds the 0.22 bracket's threshold
    // (206700), residual = max(0, 32200 - 19300-equivalent-first-taxed-
    // threshold)... asserted structurally instead of hand-deriving twice:
    // must be IDENTICAL across both years below when taxDataYear is unset.
    const laterYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === firstDecumYear.year + 10,
    )!;
    expect(laterYear.bracketTraditionalCap).toBeCloseTo(
      firstDecumYear.bracketTraditionalCap!,
      2,
    );
  });

  it("grows bracketTraditionalCap by (1+inflationRate)^(year - taxDataYear) when taxDataYear is set — the actual regression this test exists to catch", () => {
    const inflationRate = 0.03;
    const baseResult = calculateProjection(
      makeInput({ taxDataYear: undefined, inflationRate }),
    );
    const baseCap = baseResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!.bracketTraditionalCap!;

    const firstDecumYearCalendarYear = baseResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!.year;
    const taxDataYear = firstDecumYearCalendarYear - 10; // tax data is 10 years stale
    const grownResult = calculateProjection(
      makeInput({ taxDataYear, inflationRate }),
    );
    const grownYear = grownResult.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const expectedCap = baseCap * Math.pow(1 + inflationRate, 10);
    expect(grownYear.bracketTraditionalCap).toBeCloseTo(expectedCap, 0);
    // And it keeps growing further into the projection, not just a one-time bump.
    const laterGrownYear = grownResult.projectionByYear.find(
      (y) => y.phase === "decumulation" && y.year === grownYear.year + 5,
    )!;
    expect(laterGrownYear.bracketTraditionalCap!).toBeGreaterThan(
      grownYear.bracketTraditionalCap!,
    );
  });
});
