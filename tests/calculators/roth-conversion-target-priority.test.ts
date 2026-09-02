/**
 * Regression test for an advisor-caught priority-ordering bug
 * (2026-09-01) in decumulation-year.ts's rothBracketTarget fallback param
 * passed to performRothConversion.
 *
 * That fallback is only consulted when config.rothConversionTarget (a
 * per-year override) is undefined — the common case, since nothing in the
 * UI creates a per-year rothConversionTarget override without also
 * setting rothBracketTarget for it. The bug: the OLD priority put a
 * per-year WITHDRAWAL-routing override (config.rothBracketTarget) ahead of
 * the household's own explicit plan-level rothConversionTarget
 * (taxRates.rothConversionTarget) — so a per-year override that only
 * meant to change withdrawal routing for one year would silently retarget
 * Roth CONVERSIONS too, overriding a more specific, deliberately-set
 * plan-level choice. Fixed by reordering to
 * `taxRates.rothConversionTarget ?? config.rothBracketTarget ??
 * taxRates.rothBracketTarget`.
 *
 * This never shipped wrong numbers (the multi-year withdrawal-policy
 * optimizer always pairs an explicit rothConversionTarget whenever
 * conversions are on, bypassing the fallback), but was real and reachable
 * for a household that creates this override combination by hand via the
 * Retirement page's decumulation override form.
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
        enableRothConversions: true,
        // Household's own deliberate, conservative conversion ceiling —
        // separate from (and lower than) their withdrawal bracket target.
        rothConversionTarget: 0.12,
        rothBracketTarget: 0.24,
        taxBrackets: [
          { threshold: 0, baseWithholding: 0, rate: 0.1 },
          { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
          { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          { threshold: 383900, baseWithholding: 78221, rate: 0.32 },
        ],
        grossUpForTaxes: true,
        taxMultiplier: 1.0,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 60,
    retirementAge: 60,
    projectionEndAge: 68,
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
      preTax: 700000,
      taxFree: 100000,
      afterTax: 80000,
      afterTaxBasis: 50000,
      hsa: 30000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 650000,
        roth: 50000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 30000 },
      ira: { structure: "roth_traditional", traditional: 50000, roth: 50000 },
      brokerage: {
        structure: "basis_tracking",
        balance: 80000,
        basis: 50000,
      },
    },
    annualExpenses: 60000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    filingStatus: "MFJ",
    asOfDate: AS_OF,
    ...overrides,
  };
}

describe("Roth conversion target priority (rothBracketTarget fallback in performRothConversion)", () => {
  it("a per-year rothBracketTarget override does NOT retarget conversions past the plan-level rothConversionTarget", () => {
    const baseline = calculateProjection(makeInput());
    const withOverride = calculateProjection(
      makeInput({
        decumulationOverrides: [
          {
            year: 2026,
            // A withdrawal-routing override only — no rothConversionTarget
            // set here, matching how a household would actually use the
            // decumulation override form.
            rothBracketTarget: 0.32,
            notes: "One-year bracket bump for a big Traditional withdrawal",
          },
        ],
      }),
    );

    const baselineYear = baseline.projectionByYear.find(
      (y) => y.year === 2026 && y.phase === "decumulation",
    );
    const overrideYear = withOverride.projectionByYear.find(
      (y) => y.year === 2026 && y.phase === "decumulation",
    );
    expect(baselineYear).toBeDefined();
    expect(overrideYear).toBeDefined();

    // The conversion amount must be identical whether or not the per-year
    // withdrawal-bracket override is present -- conversions should only
    // ever be governed by the plan-level rothConversionTarget (12%) here,
    // never by a per-year rothBracketTarget override (32%) that never
    // touched rothConversionTarget at all.
    expect(overrideYear!.rothConversionAmount).toBeCloseTo(
      baselineYear!.rothConversionAmount,
      2,
    );

    // Sanity: the override year should have a real, non-zero conversion
    // (bracket-filling to 12% still has room), so this isn't a vacuous
    // "both zero" pass.
    expect(baselineYear!.rothConversionAmount).toBeGreaterThan(0);
  });
});
