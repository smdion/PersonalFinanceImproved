/**
 * Monte Carlo honesty check for the penalty-hard-exclusion behavior.
 *
 * Before this, `successRate` only checked `terminalBalance > 0`. A
 * household whose only remaining money was penalty-exposed (and therefore
 * off-limits under `avoidPenalizedWithdrawals: true`) would under-spend
 * every year it couldn't reach that money, keep a LARGER terminal balance
 * as a result, and score as MORE successful — exactly backwards. This test
 * proves the fix: for a household that retires several years before the
 * 59½ penalty-free age with insufficient penalty-free (brokerage/basis)
 * money to bridge that gap, `successRate` collapses once the exclusion is
 * on, even though every trial still ends with money left over.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import {
  makeMCInput,
  IBBOTSON_CLASSES,
  make5050GlidePath,
} from "../benchmarks/benchmark-helpers";
import type { ProjectionInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");
const STOCK_BOND_CORRELATIONS = [
  { classAId: 1, classBId: 3, correlation: -0.1 },
];

function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.29,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.5,
        "403b": 0,
        hsa: 0.05,
        ira: 0.15,
        brokerage: 0.3,
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
      avoidPenalizedWithdrawals: true,
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 37,
    retirementAge: 55,
    projectionEndAge: 95,
    currentSalary: 300000,
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
      taxFree: 1700000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 260000,
    },
    startingAccountBalances: {
      "401k": { structure: "roth_traditional", traditional: 900000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 260000 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 1700000 },
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 94000,
    inflationRate: 0.03,
    returnRates: [{ label: "7%", rate: 0.0727 }],
    socialSecurityAnnual: 0,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  } as ProjectionInput;
}

function makeRothIndividualAccounts(ownerBirthYear: number) {
  return [
    {
      name: "Roth IRA",
      category: "ira" as const,
      taxType: "taxFree",
      startingBalance: 1700000,
      ownerName: "Owner",
      ownerPersonId: 1,
      ownerBirthYear,
      parentCategory: "Retirement",
      rothBasisMeta: {
        year: 2025,
        contributionBasis: 40000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2025-01-01"),
      },
    },
  ];
}

describe("Monte Carlo honesty (acceptance criterion 11)", () => {
  it("successRate falls when the exclusion is on for a household with a real 55->59½ penalty-free funding gap, even though trials still end with money left over", () => {
    const base = makeInput({
      individualAccounts: makeRothIndividualAccounts(1990),
    });
    const mcOpts = {
      numTrials: 300,
      seed: 42,
      assetClasses: IBBOTSON_CLASSES,
      correlations: STOCK_BOND_CORRELATIONS,
      glidePath: make5050GlidePath(),
    };

    const withExclusion = calculateMonteCarlo(makeMCInput(base, mcOpts));
    const withoutExclusion = calculateMonteCarlo(
      makeMCInput(
        {
          ...base,
          decumulationDefaults: {
            ...base.decumulationDefaults,
            avoidPenalizedWithdrawals: false,
          },
        },
        mcOpts,
      ),
    );

    // The exclusion strictly lowers successRate for this household -- the
    // core honesty property C3 exists to guarantee.
    expect(withExclusion.successRate).toBeLessThan(
      withoutExclusion.successRate,
    );
    // And it's specifically attributed to the penalty exclusion, not random
    // noise -- penaltyAvoidedShortfallRate is the smoking gun a caller (like
    // the Coast FIRE card) uses to explain a low successRate as "money you
    // have but can't reach" rather than "you'll be broke."
    expect(withExclusion.penaltyAvoidedShortfallRate).toBeGreaterThan(0);
    expect(withoutExclusion.penaltyAvoidedShortfallRate).toBe(0);
  });
});
