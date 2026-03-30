/**
 * Brokerage goals consumer integration snapshot tests.
 *
 * Exercises the full pipeline: engine output -> calculateBrokerageGoals() -> snapshot.
 * After engine refactoring, these must produce byte-identical results.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import { calculateBrokerageGoals } from "@/lib/calculators/brokerage-goals";
import type { ProjectionInput } from "@/lib/calculators/types";
import type { BrokerageGoalInput } from "@/lib/calculators/brokerage-goals";

const AS_OF = new Date("2025-03-07");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid engine input with sensible defaults. */
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
    currentAge: 35,
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
      preTax: 100000,
      taxFree: 50000,
      afterTax: 30000,
      afterTaxBasis: 20000,
      hsa: 15000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 80000,
        roth: 20000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 15000 },
      ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
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

// Round all numbers in an object to avoid floating-point noise
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roundDeep(obj: unknown, decimals = 2): any {
  if (typeof obj === "number")
    return Math.round(obj * 10 ** decimals) / 10 ** decimals;
  if (Array.isArray(obj)) return obj.map((v) => roundDeep(v, decimals));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = roundDeep(v, decimals);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("brokerage goals integration", () => {
  it("fixture 1: basic brokerage goals — two goals at different target years", () => {
    const goals: BrokerageGoalInput[] = [
      {
        id: 1,
        name: "Down payment",
        targetAmount: 50000,
        targetYear: 2030,
        priority: 1,
      },
      {
        id: 2,
        name: "Car fund",
        targetAmount: 25000,
        targetYear: 2028,
        priority: 2,
      },
    ];

    const input = makeInput({
      brokerageGoals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        targetYear: g.targetYear,
        priority: g.priority,
      })),
    });
    const engineResult = calculateProjection(input);

    const bgResult = calculateBrokerageGoals({
      asOfDate: AS_OF,
      goals,
      engineYears: engineResult.projectionByYear,
    });

    expect(bgResult.projectionByYear.length).toBeGreaterThan(0);
    expect(bgResult.goals).toHaveLength(2);
    expect(roundDeep(bgResult)).toMatchSnapshot();
  });

  it("fixture 2: goals with overflow — high contributions forcing brokerage overflow", () => {
    const goals: BrokerageGoalInput[] = [
      {
        id: 1,
        name: "Down payment",
        targetAmount: 50000,
        targetYear: 2030,
        priority: 1,
      },
    ];

    const input = makeInput({
      accumulationDefaults: {
        contributionRate: 0.5,
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
      currentSalary: 300000,
      brokerageGoals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        targetYear: g.targetYear,
        priority: g.priority,
      })),
    });
    const engineResult = calculateProjection(input);

    const bgResult = calculateBrokerageGoals({
      asOfDate: AS_OF,
      goals,
      engineYears: engineResult.projectionByYear,
    });

    // With 50% contribution rate at $300k, overflow should appear
    const hasOverflow = bgResult.projectionByYear.some((y) => y.overflow > 0);
    expect(hasOverflow).toBe(true);
    expect(roundDeep(bgResult)).toMatchSnapshot();
  });

  it("fixture 3: goals with brokerage ramp — increasing contributions over time", () => {
    const goals: BrokerageGoalInput[] = [
      {
        id: 1,
        name: "Vacation home",
        targetAmount: 100000,
        targetYear: 2035,
        priority: 1,
      },
    ];

    const input = makeInput({
      brokerageContributionRamp: 2000,
      brokerageGoals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        targetYear: g.targetYear,
        priority: g.priority,
      })),
    });
    const engineResult = calculateProjection(input);

    const bgResult = calculateBrokerageGoals({
      asOfDate: AS_OF,
      goals,
      engineYears: engineResult.projectionByYear,
    });

    expect(bgResult.goals).toHaveLength(1);
    expect(roundDeep(bgResult)).toMatchSnapshot();
  });

  it("fixture 4: goals with parentCategoryFilter — individual accounts filtered", () => {
    const goals: BrokerageGoalInput[] = [
      {
        id: 1,
        name: "Down payment",
        targetAmount: 40000,
        targetYear: 2030,
        priority: 1,
      },
    ];

    const input = makeInput({
      individualAccounts: [
        {
          name: "Taxable Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 20000,
          parentCategory: "Portfolio",
        },
        {
          name: "ESPP",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 10000,
          parentCategory: "Portfolio",
        },
        {
          name: "Savings Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 5000,
          parentCategory: "Savings",
        },
      ],
      brokerageGoals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        targetYear: g.targetYear,
        priority: g.priority,
      })),
    });
    const engineResult = calculateProjection(input);

    const bgResult = calculateBrokerageGoals({
      asOfDate: AS_OF,
      goals,
      engineYears: engineResult.projectionByYear,
      parentCategoryFilter: "Portfolio",
    });

    expect(bgResult.goals).toHaveLength(1);
    expect(roundDeep(bgResult)).toMatchSnapshot();
  });
});
