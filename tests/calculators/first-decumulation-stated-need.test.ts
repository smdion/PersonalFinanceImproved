/**
 * `firstDecumulationYearStatedNeed`
 * used to always inflate `decumulationAnnualExpenses` to the first
 * decumulation year's nominal dollars, ignoring a budget override active on
 * that exact year -- coast-fire.ts's `passes()` then compared that
 * pre-override stated need against `retirementYear.projectedExpenses`,
 * which pre-year-setup.ts DOES apply the override to. A household with a
 * year-1 decumulation override could get an apples-to-oranges verdict.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

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
      withdrawalRoutingMode: "waterfall",
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
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 150000,
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
      taxFree: 300000,
      afterTax: 200000,
      afterTaxBasis: 150000,
      hsa: 60000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 700000,
        roth: 200000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 60000 },
      ira: {
        structure: "roth_traditional",
        traditional: 200000,
        roth: 100000,
      },
      brokerage: {
        structure: "basis_tracking",
        balance: 200000,
        basis: 150000,
      },
    },
    annualExpenses: 72000,
    decumulationAnnualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 24000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  } as ProjectionInput;
}

describe("firstDecumulationYearStatedNeed", () => {
  it("without a budget override, inflates decumulationAnnualExpenses to the first decumulation year's nominal dollars", () => {
    const result = calculateProjection(makeInput());
    const firstDecumYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    // $72,000 inflated at 2.5%/yr from 2025 to the first decumulation year
    // (2030, confirmed by an engine probe) -- 72000 * 1.025^5 = 81,461.39.
    expect(firstDecumYear.year).toBe(2030);
    expect(result.firstDecumulationYearStatedNeed).toBeCloseTo(81461.39, 2);
  });

  it("with a budget override active on the first decumulation year, reads the override instead of the stale inflated figure", () => {
    const base = calculateProjection(makeInput());
    const firstDecumYear = base.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const result = calculateProjection(
      makeInput({
        // $4,000/mo -> $48,000/yr, well below the ~$81.5k inflated figure.
        budgetOverrides: [{ year: firstDecumYear.year, value: 4000 }],
      }),
    );
    const overriddenYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    // The engine loop itself applied the override to projectedExpenses --
    // firstDecumulationYearStatedNeed must agree with it, not the
    // pre-override inflated figure.
    expect(overriddenYear.projectedExpenses).toBe(48000);
    expect(result.firstDecumulationYearStatedNeed).toBe(48000);
  });

  it("a budget override on a LATER year does not affect the first year's stated need", () => {
    const base = calculateProjection(makeInput());
    const firstDecumYear = base.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const result = calculateProjection(
      makeInput({
        budgetOverrides: [{ year: firstDecumYear.year + 3, value: 4000 }],
      }),
    );
    expect(result.firstDecumulationYearStatedNeed).toBeCloseTo(81461.39, 2);
  });

  it("Rate-Seeded scenario's year-1 override carve-out: an override on the first decumulation year is ignored, matching pre-year-setup.ts's skipOverrideThisYear", () => {
    const base = calculateProjection(makeInput());
    const firstDecumYear = base.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    const result = calculateProjection(
      makeInput({
        rateSeededDecumulationYear1: true,
        budgetOverrides: [{ year: firstDecumYear.year, value: 4000 }],
      }),
    );
    const overriddenYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    // pre-year-setup.ts's skipOverrideThisYear means the override was never
    // applied to year 1 of the loop either -- the actual spending is the
    // rate-seeded figure (withdrawalRate x balance), not the $48,000
    // override, and firstDecumulationYearStatedNeed must not pick up the
    // override here either. It stays the plain inflated stated-need figure
    // (matching the no-override case) -- a deliberately separate concept
    // from the rate-seeded actual, used by coast-fire.ts to ask "is the
    // rate-seeded plan spending at least as much as the household's stated
    // budget," so the two numbers are NOT expected to match each other.
    expect(overriddenYear.projectedExpenses).not.toBe(48000);
    expect(result.firstDecumulationYearStatedNeed).not.toBe(48000);
    expect(result.firstDecumulationYearStatedNeed).toBeCloseTo(81461.39, 2);
  });
});
