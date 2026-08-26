/**
 * Regression test for two bugs found by advisor + code review (2026-08-27,
 * ahead of the v0.7.8 release): the post-Roth-conversion `taxCost`
 * recompute and `currentYearMagi` in decumulation-year.ts were never
 * updated when the v0.7.8 Roth-tax-basis pass split Roth withdrawals into
 * a taxable-growth portion and a tax-free portion — both silently dropped
 * non-qualified Roth growth income whenever a year ALSO triggered a Roth
 * conversion + had brokerage gains (the only branch that re-derives
 * taxCost instead of reading computeTaxFromSlots's own value).
 *
 * Bug A: `actualTaxableIncome` was re-derived locally as
 * `totalTraditionalWithdrawal + taxableSS`, omitting rothTaxableGrowth —
 * fed into the LTCG bracket calc and MAGI.
 * Bug B: the post-conversion `taxCost` recompute taxed the WHOLE Roth
 * withdrawal at `taxRates.roth` (0 by default) instead of splitting out
 * taxable growth at the traditional rate — silently zeroing tax on
 * non-qualified Roth growth in exactly this scenario.
 *
 * This fixture combines all three ingredients needed to trigger both:
 * enableRothConversions + brokerage gains (the recompute-taxCost branch)
 * AND a pre-59½ Roth IRA growth draw (avoidPenalizedWithdrawals: false,
 * so growth is actually drawn and taxable).
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
      withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
      withdrawalSplits: {
        "401k": 0.2,
        "403b": 0,
        ira: 0.4,
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
        rothConversionTarget: 0.22,
        taxBrackets: [
          { threshold: 0, baseWithholding: 0, rate: 0.1 },
          { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
          { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
        ],
        grossUpForTaxes: true,
        taxMultiplier: 1.0,
      },
      avoidPenalizedWithdrawals: false,
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 50,
    retirementAge: 50,
    projectionEndAge: 58,
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
      taxFree: 250000,
      afterTax: 300000,
      afterTaxBasis: 100000,
      hsa: 30000,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 700000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 30000 },
      // Small basis relative to balance -- guarantees a real growth draw.
      ira: { structure: "roth_traditional", traditional: 0, roth: 250000 },
      brokerage: {
        structure: "basis_tracking",
        balance: 300000,
        basis: 100000,
      },
    },
    annualExpenses: 150000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    filingStatus: "MFJ",
    asOfDate: AS_OF,
    individualAccounts: [
      {
        name: "Roth IRA",
        category: "ira",
        taxType: "taxFree",
        startingBalance: 250000,
        ownerName: "Alice",
        ownerPersonId: 1,
        ownerBirthYear: 1980, // age 45-49 over the window -- never 59½
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
  } as ProjectionInput;
}

describe("Roth growth income correctly reaches MAGI/taxCost in a Roth-conversion + brokerage-gains year (advisor review 2026-08-27)", () => {
  it("taxCost is meaningfully higher than an otherwise-identical household whose growth is untaxed — proves growth's tax isn't silently zeroed (Bug B)", () => {
    // A same-year, same-everything-else comparison against a variant with
    // no individual-account Roth tracking at all (so rothTaxableGrowth is
    // always 0) isolates growth's OWN tax contribution. Under the bug,
    // the post-conversion recompute branch taxed growth at taxRates.roth
    // (0 by default) instead of actualTraditionalRate, so a fixed sibling
    // test confirmed this comparison is a NO-OP under the old code (taxCost
    // for both variants came out equal) -- it only discriminates correctly
    // now that the fix is in. The 10% floor is well below this fixture's
    // real marginal rate (ordinary income here is deep into the top
    // bracket after the Roth conversion) but comfortably above the ~$0 the
    // bug produced.
    const withGrowthTaxed = calculateProjection(makeInput());
    const withoutIndividualTracking = calculateProjection(
      makeInput({ individualAccounts: undefined }),
    );

    const decumA = withGrowthTaxed.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    const decumB = withoutIndividualTracking.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );

    let comparedAtLeastOneYear = false;
    for (let i = 0; i < decumA.length; i++) {
      const a = decumA[i];
      const b = decumB[i];
      if (!a || !b) continue;
      const ia = a.individualAccountBalances?.find(
        (acct) => acct.name === "Roth IRA",
      );
      const growthDrawn = Math.max(
        0,
        (ia?.withdrawal ?? 0) - (ia?.rothBasisDrawn ?? 0),
      );
      // Isolate years where the specific bug-triggering combination fires:
      // a Roth conversion happened AND growth was actually drawn.
      if (
        (a.rothConversionAmount ?? 0) > 0.01 &&
        growthDrawn > 100 &&
        a.taxCost != null &&
        b.taxCost != null
      ) {
        comparedAtLeastOneYear = true;
        expect(a.taxCost).toBeGreaterThan(b.taxCost + growthDrawn * 0.1);
      }
    }
    // The fixture must actually exercise the combined scenario, or this
    // test would pass vacuously.
    expect(comparedAtLeastOneYear).toBe(true);
  });
});
