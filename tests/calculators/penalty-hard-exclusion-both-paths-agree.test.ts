/**
 * Acceptance criterion 7 (v0.7.8 penalty-hard-exclusion pass — see
 * .scratch/docs/plans/DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md):
 * "Both paths agree." `estimateWithdrawalTaxCost`'s estimate and the real
 * decumulation-year.ts execution must produce the same `penaltyCost` for
 * identical inputs — same requirement Group 0's criterion 5 and
 * roth-tax-basis's criterion 4 impose on `taxCost`.
 *
 * Not asserted by white-boxing either function's internals (both paths
 * aren't separately inspectable from calculateProjection's output) — same
 * approach those two prior criteria use. Instead: `estimateWithdrawalTaxCost`
 * sizes `targetWithdrawal` so after-tax proceeds cover `afterTaxNeed`
 * INCLUDING the penalty it predicts. If the real path's `penaltyCost`
 * (computed independently, from the REAL routed slots) diverged from what
 * the estimate assumed when sizing the withdrawal, the real after-tax
 * proceeds would fall short of `afterTaxNeed` by exactly that divergence.
 * Conservation holding is the observable proof the two agreed.
 *
 * Uses `avoidPenalizedWithdrawals: false` so a pre-59½ Roth owner's growth
 * is actually drawn and penalized (the default-on exclusion would prevent
 * this scenario from ever charging a penalty at all) -- this is also a
 * "cost path is exercised" fixture (criterion 6, full-pipeline variant of
 * the unit-level tests in early-withdrawal-penalty.test.ts).
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
      withdrawalRoutingMode: "percentage",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: {
        "401k": 0.1,
        "403b": 0,
        ira: 0.8,
        brokerage: 0.1,
        hsa: 0,
      },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
      avoidPenalizedWithdrawals: false,
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 45,
    retirementAge: 50,
    projectionEndAge: 58,
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
      preTax: 50000,
      taxFree: 30000,
      afterTax: 10000,
      afterTaxBasis: 8000,
      hsa: 5000,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 50000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 5000 },
      // Small basis, large growth relative to it -- guarantees growth gets
      // drawn (and penalized) once basis is exhausted.
      ira: { structure: "roth_traditional", traditional: 0, roth: 150000 },
      brokerage: { structure: "basis_tracking", balance: 10000, basis: 8000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 20000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    individualAccounts: [
      {
        name: "Roth IRA",
        category: "ira",
        taxType: "taxFree",
        startingBalance: 150000,
        ownerName: "Alice",
        ownerPersonId: 1,
        ownerBirthYear: 1980, // age 45-53 over the window -- never 59½
        parentCategory: "Retirement",
        rothBasisMeta: {
          year: 2025,
          contributionBasis: 10000,
          conversionBasis: 0,
          latestConversionYear: null,
          isSeeded: false,
          updatedAt: new Date("2025-01-01"),
        },
      },
    ],
    ...overrides,
  };
}

describe("penalty-hard-exclusion: both paths agree (criterion 7)", () => {
  it("real after-tax proceeds cover afterTaxNeed including the penalty, in every year the penalty was charged", () => {
    const input = makeInput();
    const result = calculateProjection(input);

    const decumYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );

    let sawPenalizedYear = false;
    for (const yr of decumYears) {
      const penaltyCost = yr.penaltyCost ?? 0;
      if (penaltyCost <= 0.01) continue;
      // A year with real unmetNeed (post-fix funding-shortfall
      // reconciliation, decumulation-year.ts) is the household genuinely
      // running low on money -- this fixture's portfolio is intentionally
      // small relative to its expenses so growth gets drawn (and
      // penalized) at all, and by the later years it legitimately can't
      // cover the need regardless of gross-up correctness. That's a
      // different failure mode than "the two paths disagreed on the
      // penalty," which is what this test exists to catch -- exclude it.
      if ((yr.unmetNeed ?? 0) > 0.01) continue;
      sawPenalizedYear = true;

      const taxCost = yr.taxCost ?? 0;
      const afterTaxProceeds = yr.totalWithdrawal - taxCost - penaltyCost;
      // If the estimate (tax-gross-up.ts) and the real path
      // (decumulation-year.ts) had disagreed on the penalty magnitude when
      // sizing this withdrawal, afterTaxProceeds would fall short of
      // afterTaxNeed by exactly that divergence. $1 tolerance for the
      // secant convergence's own rounding (roundToCents at each step) and
      // the RMD/Roth-conversion residual this module's header docblock
      // documents as an accepted gap -- not the multi-thousand-dollar
      // divergence this test was written to catch.
      expect(afterTaxProceeds).toBeGreaterThanOrEqual(yr.afterTaxNeed - 1);
    }
    // The scenario must actually exercise the cost path in at least one
    // year the household could still afford, or this test would pass
    // vacuously.
    expect(sawPenalizedYear).toBe(true);
  });
});
