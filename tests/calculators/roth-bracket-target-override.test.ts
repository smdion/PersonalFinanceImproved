/**
 * Multi-year withdrawal-policy optimizer, Phase 1 (2026-08-29) --
 * `rothBracketTarget` as a real per-year `DecumulationOverride`.
 * Previously this lived only at `decumulationDefaults.distributionTaxRates
 * .rothBracketTarget`, a single fixed value for the whole plan with no
 * override path at all -- added so a future multi-year search can express
 * "try this bracket target for this candidate" the same way
 * `accumulationOverrides` already lets Coast FIRE express a candidate
 * contribution rate. See
 * `.scratch/docs/plans/PLAN-v0.7.10-multi-year-withdrawal-optimizer.md`.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  ProjectionInput,
  EngineDecumulationYear,
} from "@/lib/calculators/types";

const isDecumulationYear = (y: {
  phase: string;
}): y is EngineDecumulationYear => y.phase === "decumulation";

const AS_OF = new Date("2025-03-07");

const MFJ_BRACKETS = [
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
];

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.25,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
      taxSplits: { "401k": 0.5, ira: 1.0 },
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
        rothBracketTarget: 0.12, // plan default -- the value the override should beat
        taxBrackets: MFJ_BRACKETS,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 60,
    projectionEndAge: 85,
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
      preTax: 900000,
      taxFree: 200000,
      afterTax: 150000,
      afterTaxBasis: 100000,
      hsa: 30000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 700000,
        roth: 200000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 30000 },
      ira: { structure: "roth_traditional", traditional: 200000, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 150000,
        basis: 100000,
      },
    },
    annualExpenses: 60000,
    decumulationAnnualExpenses: 60000,
    inflationRate: 0.025,
    returnRates: [{ label: "6%", rate: 0.06 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
    ...overrides,
  };
}

describe("rothBracketTarget as a per-year decumulationOverride", () => {
  it("with no override, uses the plan default every year (unchanged behavior)", () => {
    const result = calculateProjection(makeInput());
    const firstDecumYear = result.projectionByYear.find(isDecumulationYear)!;
    // bracketTraditionalCap reflects the 12% bracket target (plan default).
    // incomeCapForMarginalRate(0.12, MFJ_BRACKETS) returns the threshold
    // of the first bracket whose rate EXCEEDS 0.12 -- the 22% bracket's
    // own start, $206,700 -- confirming the plan default (not some other
    // value) actually governed this year's routing.
    expect(firstDecumYear.bracketTraditionalCap).toBeCloseTo(206700, 0);
  });

  it("a per-year override changes bracketTraditionalCap in the overridden year, and reverts after", () => {
    const base = calculateProjection(makeInput());
    const firstDecumYear = base.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const overriddenResult = calculateProjection(
      makeInput({
        decumulationOverrides: [
          { year: firstDecumYear.year, rothBracketTarget: 0.22 },
          { year: firstDecumYear.year + 1, rothBracketTarget: 0.12 }, // revert
        ],
      }),
    );
    const overriddenYear = overriddenResult.projectionByYear.find(
      (y): y is EngineDecumulationYear =>
        isDecumulationYear(y) && y.year === firstDecumYear.year,
    )!;
    const revertedYear = overriddenResult.projectionByYear.find(
      (y): y is EngineDecumulationYear =>
        isDecumulationYear(y) && y.year === firstDecumYear.year + 1,
    )!;
    // incomeCapForMarginalRate(0.22, ...) returns the 24% bracket's own
    // start, $394,600 -- a real, hand-verifiable jump from the 12%
    // default's $206,700.
    expect(overriddenYear.bracketTraditionalCap).toBeCloseTo(394600, 0);
    expect(revertedYear.bracketTraditionalCap).toBeCloseTo(206700, 0);
  });

  it("is sticky-forward: an override with no later reset applies to every subsequent year", () => {
    const base = calculateProjection(makeInput());
    const firstDecumYear = base.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const result = calculateProjection(
      makeInput({
        decumulationOverrides: [
          { year: firstDecumYear.year, rothBracketTarget: 0.22 },
        ],
      }),
    );
    const laterYears = result.projectionByYear.filter(
      (y): y is EngineDecumulationYear =>
        isDecumulationYear(y) && y.year > firstDecumYear.year,
    );
    expect(laterYears.length).toBeGreaterThan(0);
    for (const y of laterYears.slice(0, 3)) {
      expect(y.bracketTraditionalCap).toBeCloseTo(394600, 0);
    }
  });

  // Regression guard (verified via manual toggle, not asserted here as a
  // separate test): reverting decumulation-year.ts's
  // `config.rothBracketTarget ?? taxRates.rothBracketTarget` back to
  // reading `taxRates.rothBracketTarget` alone makes the "a per-year
  // override changes bracketTraditionalCap" test above fail (the override
  // would be silently ignored) -- confirms this test file actually
  // discriminates the fix, not just exercises the code path.
});
