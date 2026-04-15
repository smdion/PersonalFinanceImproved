/**
 * Fixture: person retiring mid-year — retirementAge === currentAge.
 *
 * This profile exercises the `retirementAge === currentAge` edge case where
 * the person is ALREADY at retirement age on the as-of date but has not yet
 * crossed the calendar-year boundary (firstYearFraction < 1).
 *
 * Wall clock: 2026-04-14
 *   month = 3 (April, 0-indexed), day = 14 (≤ 15 → not past mid-month)
 *   monthsRemaining = 12 − 3 = 9
 *   firstYearFraction = 9 / 12 = 0.75
 *
 * ── EXPECTED BEHAVIOR (option-b semantics, advisor-mandated) ──────────────
 *
 * When retirementAge === currentAge AND firstYearFraction < 1, the engine
 * should treat y=0 as ONE final partial accumulation year (not decumulation).
 * Decumulation starts at y=1 (age 66, next calendar year).
 *
 * Rationale: running a full decumulation year at y=0 applies full
 * withdrawals against a portfolio that hasn't had the benefit of the
 * partial-year contributions and growth. Option-b keeps every handler
 * "clean-year" by doing one more accumulation pass (pro-rated by
 * firstYearFraction) before switching phases.
 *
 * ── HAND-COMPUTED YEAR-0 ACCUMULATION (for reviewer verification) ─────────
 *
 *   startingPreTax = 500 000
 *   salary         = 100 000
 *   contributionRate = 0.10 (no per-category overrides)
 *   firstYearFraction = 0.75 (9 of 12 months)
 *   returnRate (single rate) = 0.07
 *
 *   proRated employee contribution = 100 000 × 0.10 × 0.75 = 7 500
 *   proRated return factor         = (1.07)^0.75 − 1 ≈ 0.052222
 *   growth on starting balance     ≈ 500 000 × 0.052222 = 26 111
 *   growth on mid-year contribs    ≈ small (contributions land mid-year)
 *
 *   Expected year-0 endBalance ≈ 500 000 + 7 500 + 26 111 ≈ 533 611
 *
 * The exact number is locked by the snapshot test (B1c) after B1b is
 * implemented. Here we only assert PHASE and first-decumulation AGE.
 *
 * ── CURRENT (BUGGY) BEHAVIOR ─────────────────────────────────────────────
 *
 *   isAccumulation = age < retirementAge = 65 < 65 = false  ← immediately wrong
 *   y=0 runs as full decumulation → withdrawals, no contributions
 *
 * ── THIS TEST IS INTENTIONALLY RED until B1b lands ────────────────────────
 */
import type { ProjectionInput } from "@/lib/calculators/types";

export const RETIRING_MIDYEAR_AS_OF = new Date("2026-04-14T12:00:00Z");

/** Minimal input with retirementAge === currentAge on 2026-04-14. */
export function makeRetiringMidyearInput(
  overrides: Partial<ProjectionInput> = {},
): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.1,
      routingMode: "waterfall",
      accountOrder: ["401k"],
      accountSplits: { "401k": 1.0 },
      taxSplits: { "401k": 1.0 },
    },
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k"],
      withdrawalSplits: { "401k": 1.0 },
      withdrawalTaxPreference: { "401k": "traditional" },
      distributionTaxRates: {
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 65,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 100000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 24500,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 8000 },
    employerMatchRateByCategory: {
      "401k": 0,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 500000,
      taxFree: 0,
      afterTax: 0,
      afterTaxBasis: 0,
      hsa: 0,
    },
    annualExpenses: 40000,
    inflationRate: 0.03,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 24000,
    ssStartAge: 67,
    asOfDate: RETIRING_MIDYEAR_AS_OF,
    ...overrides,
  };
}
