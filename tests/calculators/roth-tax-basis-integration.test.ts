/**
 * Full-pipeline integration test for Roth growth-vs-basis taxability
 * (v0.7.8 Roth-tax-basis follow-up, DESIGN-DECISION-v0.7.8-roth-tax-basis.md).
 *
 * Acceptance criteria exercised here:
 *   4. Both paths agree — the tax-gross-up estimate and the real
 *      decumulation execution must not diverge on rothTaxableGrowth for the
 *      same routed slots. Not asserted directly (both paths aren't
 *      separately inspectable from calculateProjection's output), but
 *      criterion 9 below would fail if they silently diverged, since the
 *      estimate feeds the gross-up factor that sizes the real withdrawal.
 *   5. The estimate must not mutate real state — proven structurally here
 *      by running the SAME projection twice (real determinism) rather than
 *      by inspecting internal Maps (out of this file's reach).
 *   9. An under-59½ household with Roth growth withdrawals must show a
 *      strictly higher taxCost than an otherwise-identical household whose
 *      Roth owner is already qualified (59½+) — never lower, in any year
 *      where non-qualified growth was actually drawn.
 *
 * Both fixtures hold currentAge/retirementAge/projectionEndAge (and so RMD
 * timing, SS timing, expenses) IDENTICAL -- only the Roth account's own
 * ownerBirthYear differs -- isolating the effect to Roth tax treatment
 * alone, not a confound from some other age-driven engine behavior.
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
      // This suite isolates Roth growth-vs-basis taxability from the
      // separate v0.7.8 penalty-hard-exclusion feature (which would
      // otherwise stop growth from being drawn at all pre-59½, defeating
      // the premise this test is built on).
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
      preTax: 100000,
      taxFree: 30000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 15000,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 80000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 150000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  };
}

function makeRothIndividualAccounts(ownerBirthYear: number) {
  return [
    {
      name: "Roth IRA",
      category: "ira" as const,
      taxType: "taxFree",
      startingBalance: 150000,
      ownerName: "Alice",
      ownerPersonId: 1,
      ownerBirthYear,
      parentCategory: "Retirement",
      // Small tracked basis relative to balance -- most of what's drawn
      // over the projection will be growth, maximizing the tax-treatment
      // difference between the qualified and non-qualified fixtures.
      rothBasisMeta: {
        year: 2025,
        contributionBasis: 15000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2025-01-01"),
      },
    },
  ];
}

describe("Roth growth-vs-basis taxability — full pipeline", () => {
  it("a non-qualified (under 59½) Roth owner pays strictly more tax than an otherwise-identical qualified owner, in years growth is drawn", () => {
    // Never crosses 59.5 across the whole decumulation window (retire at
    // 50, end at 58) -- isolates the effect to basis-vs-growth taxability,
    // not the age gate flipping mid-projection.
    const nonQualifiedInput = makeInput({
      individualAccounts: makeRothIndividualAccounts(1980), // age 45-53 over the projection window
    });
    // Already well past 59.5 for the entire window.
    const qualifiedInput = makeInput({
      individualAccounts: makeRothIndividualAccounts(1955), // age 70-78 over the projection window
    });

    const nonQualifiedResult = calculateProjection(nonQualifiedInput);
    const qualifiedResult = calculateProjection(qualifiedInput);

    const isDecumYear = (
      yr: (typeof nonQualifiedResult.projectionByYear)[number],
    ): yr is Extract<typeof yr, { phase: "decumulation" }> =>
      yr.phase === "decumulation";

    const nonQualifiedYears =
      nonQualifiedResult.projectionByYear.filter(isDecumYear);
    const qualifiedYears = qualifiedResult.projectionByYear.filter(isDecumYear);

    let sawGrowthDrawnYearWithHigherTax = false;
    for (let i = 0; i < nonQualifiedYears.length; i++) {
      const nq = nonQualifiedYears[i];
      const q = qualifiedYears[i];
      if (!nq || !q) continue;
      const nqRoth = nq.individualAccountBalances.find(
        (a) => a.name === "Roth IRA",
      );
      const nqWithdrawal = nqRoth?.withdrawal ?? 0;
      const nqBasisDrawn = nqRoth?.rothBasisDrawn ?? 0;
      const grewthDrawnThisYear = nqWithdrawal - nqBasisDrawn;
      if (grewthDrawnThisYear > 1 && nq.taxCost != null && q.taxCost != null) {
        // Never lower -- acceptance criterion 9's "never decreases" clause.
        expect(nq.taxCost).toBeGreaterThanOrEqual(q.taxCost - 0.01);
        if (nq.taxCost > q.taxCost + 0.01) {
          sawGrowthDrawnYearWithHigherTax = true;
        }
      }
    }

    expect(sawGrowthDrawnYearWithHigherTax).toBe(true);
  });

  it("determinism: running the same projection twice produces identical taxCost (estimate never leaks state across runs)", () => {
    const input = makeInput({
      individualAccounts: makeRothIndividualAccounts(1980),
    });
    const result1 = calculateProjection(input);
    const result2 = calculateProjection(input);
    expect(result1.sustainableWithdrawal).toBe(result2.sustainableWithdrawal);
    expect(
      result1.projectionByYear.map((y) =>
        "taxCost" in y ? y.taxCost : undefined,
      ),
    ).toEqual(
      result2.projectionByYear.map((y) =>
        "taxCost" in y ? y.taxCost : undefined,
      ),
    );
  });
});
