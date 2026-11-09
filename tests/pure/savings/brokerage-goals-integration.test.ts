/**
 * Brokerage goals consumer integration tests.
 *
 * Exercises the full pipeline: engine output -> calculateBrokerageGoals() ->
 * the figures that matter, pinned by name (they were a 123 KB snapshot).
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { BrokerageGoalInput } from "@/lib/pure/savings/brokerage-goals";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";

const AS_OF = new Date("2025-03-07");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid engine input with sensible defaults. */
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return withCapsAge({
    budgetContributionLines: 0,
    accumulationDefaults: makeAccumulationDefaults({
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
    }),
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
        ...shippedTaxTables(),
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 35,
    retirementYear: AS_OF.getFullYear() + 30,
    projectionEndYear: AS_OF.getFullYear() + 55,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    irsLimitCaps: capsFromBaseLimits({
      baseLimits: {
        "401k": 23500,
        "403b": 23500,
        hsa: 4300,
        ira: 7000,
        brokerage: 0,
      },
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
      currentAge: 35,
    }),
    limitGrowthRate: 0.02,

    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 110000,
      taxFree: 40000,
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
  });
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

/** What a fixture pins (the figures its old whole-result snapshot held
 *  that matter): every goal, the warnings, the year count, each goal
 *  year's flows, withdrawals and accounts, and the first and last years. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function headline(result: unknown): any {
  const r = roundDeep(result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ys: any[] = r.projectionByYear;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const year = (y: any) => ({
    year: y.year,
    contribution: y.contribution,
    overflow: y.overflow,
    growth: y.growth,
    endBalance: y.endBalance,
    endBasis: y.endBasis,
  });
  return {
    goals: r.goals,
    warnings: r.warnings,
    years: ys.length,
    goalYears: ys
      .filter((y) => y.goalWithdrawals.length > 0)
      .map((y) => ({
        ...year(y),
        goalWithdrawals: y.goalWithdrawals,
        individualAccounts: y.individualAccounts,
      })),
    first: year(ys[0]),
    last: year(ys.at(-1)),
  };
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
    // Explicit value assertions — this fixture previously relied on
    // toMatchSnapshot() alone for its financial content, matching the T13
    // convention engine-snapshot.test.ts uses.
    const downPayment = bgResult.goals.find((g) => g.id === 1)!;
    expect(downPayment.funded).toBe(false);
    expect(downPayment.actualWithdrawal).toBe(40530.78);
    expect(downPayment.shortfall).toBe(9469.22);
    expect(headline(bgResult)).toEqual({
      goals: [
        {
          actualWithdrawal: 40530.78,
          funded: false,
          id: 1,
          name: "Down payment",
          projectedBalance: 40530.78,
          shortfall: 9469.22,
          targetAmount: 50000,
          targetYear: 2030,
          taxCost: 2283.22,
        },
        {
          actualWithdrawal: 25000,
          funded: true,
          id: 2,
          name: "Car fund",
          projectedBalance: 51142.88,
          shortfall: 0,
          targetAmount: 25000,
          targetYear: 2028,
          taxCost: 1494.99,
        },
      ],
      warnings: [],
      years: 55,
      goalYears: [
        {
          year: 2028,
          contribution: 4047.22,
          overflow: 4047.22,
          growth: 3345.8,
          endBalance: 26142.88,
          endBasis: 15720.65,
          goalWithdrawals: [
            {
              amount: 25000,
              basisPortion: 15033.4,
              gainsPortion: 9966.6,
              goalId: 2,
              name: "Car fund",
              taxCost: 1494.99,
            },
          ],
          individualAccounts: [],
        },
        {
          year: 2030,
          contribution: 5050.76,
          overflow: 5050.76,
          growth: 2651.55,
          endBalance: 0,
          endBasis: 0,
          goalWithdrawals: [
            {
              amount: 40530.78,
              basisPortion: 25309.34,
              gainsPortion: 15221.44,
              goalId: 1,
              name: "Down payment",
              taxCost: 2283.22,
            },
          ],
          individualAccounts: [],
        },
      ],
      first: {
        year: 2025,
        contribution: 0,
        overflow: 0,
        growth: 31740.06,
        endBalance: 31740.06,
        endBasis: 20000,
      },
      last: {
        year: 2079,
        contribution: 0,
        overflow: 0,
        growth: 118647.02,
        endBalance: 1813604.45,
        endBasis: 110117.97,
      },
    });
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
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.5,
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
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
    expect(headline(bgResult)).toEqual({
      goals: [
        {
          actualWithdrawal: 50000,
          funded: true,
          id: 1,
          name: "Down payment",
          projectedBalance: 957078.4,
          shortfall: 0,
          targetAmount: 50000,
          targetYear: 2030,
          taxCost: 1656.13,
        },
      ],
      warnings: [],
      years: 55,
      goalYears: [
        {
          year: 2030,
          contribution: 135469.09,
          overflow: 135469.09,
          growth: 62612.61,
          endBalance: 907078.4,
          endBasis: 706779.72,
          goalWithdrawals: [
            {
              amount: 50000,
              basisPortion: 38959.13,
              gainsPortion: 11040.87,
              goalId: 1,
              name: "Down payment",
              taxCost: 1656.13,
            },
          ],
          individualAccounts: [],
        },
      ],
      first: {
        year: 2025,
        contribution: 90200,
        overflow: 90200,
        growth: 36971.84,
        endBalance: 127171.84,
        endBasis: 110200,
      },
      last: {
        year: 2079,
        contribution: 0,
        overflow: 0,
        growth: 5630277.01,
        endBalance: 86062805.73,
        endBasis: 5441121.41,
      },
    });
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
    // Explicit value assertions.
    expect(bgResult.goals[0]!.funded).toBe(true);
    expect(bgResult.goals[0]!.actualWithdrawal).toBe(100000);
    expect(bgResult.goals[0]!.shortfall).toBe(0);
    expect(headline(bgResult)).toEqual({
      goals: [
        {
          actualWithdrawal: 100000,
          funded: true,
          id: 1,
          name: "Vacation home",
          projectedBalance: 284306.15,
          shortfall: 0,
          targetAmount: 100000,
          targetYear: 2035,
          taxCost: 5285.77,
        },
      ],
      warnings: [],
      years: 55,
      goalYears: [
        {
          year: 2035,
          contribution: 27975.85,
          overflow: 7975.85,
          growth: 18599.47,
          endBalance: 184306.15,
          endBasis: 119359.46,
          goalWithdrawals: [
            {
              amount: 100000,
              basisPortion: 64761.52,
              gainsPortion: 35238.48,
              goalId: 1,
              name: "Vacation home",
              taxCost: 5285.77,
            },
          ],
          individualAccounts: [],
        },
      ],
      first: {
        year: 2025,
        contribution: 0,
        overflow: 0,
        growth: 31740.06,
        endBalance: 31740.06,
        endBasis: 20000,
      },
      last: {
        year: 2079,
        contribution: 80000,
        overflow: 0,
        growth: 734496.34,
        endBalance: 12450158.27,
        endBasis: 955699.19,
      },
    });
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
      // Every account makeInput()'s balances hold, so the two agree; the
      // brokerages sum to its brokerage balance (30000) -- a mismatch there
      // is a real correction the engine applies at end of year, and this
      // fixture isn't testing that.
      individualAccounts: [
        {
          name: "401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 80000,
          parentCategory: "Retirement",
        },
        {
          name: "401k",
          category: "401k",
          taxType: "taxFree",
          startingBalance: 20000,
          parentCategory: "Retirement",
        },
        {
          name: "IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 30000,
          parentCategory: "Retirement",
        },
        {
          name: "IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 20000,
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 15000,
          parentCategory: "Retirement",
        },
        {
          name: "Taxable Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 18000,
          parentCategory: "Portfolio",
        },
        {
          name: "ESPP",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 9000,
          parentCategory: "Portfolio",
        },
        {
          // A retirement brokerage: goals (Portfolio money) never draw it.
          name: "Retirement Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 3000,
          parentCategory: "Retirement",
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
    });

    expect(bgResult.goals).toHaveLength(1);
    // Explicit value assertions.
    expect(bgResult.goals[0]!.funded).toBe(true);
    expect(bgResult.goals[0]!.actualWithdrawal).toBe(40000);
    // Portfolio accounts only ($27,000 grown to 2030); the goal no longer
    // draws part of its $40,000 from the retirement brokerage.
    expect(bgResult.goals[0]!.projectedBalance).toBe(40065.37);
    expect(headline(bgResult)).toEqual({
      goals: [
        {
          actualWithdrawal: 40000,
          funded: true,
          id: 1,
          name: "Down payment",
          projectedBalance: 40065.37,
          shortfall: 0,
          targetAmount: 40000,
          targetYear: 2030,
          taxCost: 3304.41,
        },
      ],
      warnings: [],
      years: 55,
      goalYears: [
        {
          year: 2030,
          contribution: 0,
          overflow: 0,
          growth: 2621.1,
          endBalance: 65.37,
          endBasis: 29.37,
          goalWithdrawals: [
            {
              amount: 40000,
              basisPortion: 17970.63,
              gainsPortion: 22029.37,
              goalId: 1,
              name: "Down payment",
              taxCost: 3304.41,
            },
          ],
          individualAccounts: [
            {
              balance: 43.58,
              category: "brokerage",
              contribution: 0,
              employerMatch: 0,
              growth: 1747.4,
              intentionalContribution: 0,
              name: "Taxable Brokerage",
              overflowContribution: 0,
            },
            {
              balance: 21.79,
              category: "brokerage",
              contribution: 0,
              employerMatch: 0,
              growth: 873.7,
              intentionalContribution: 0,
              name: "ESPP",
              overflowContribution: 0,
            },
          ],
        },
      ],
      first: {
        year: 2025,
        contribution: 0,
        overflow: 0,
        growth: 1566.06,
        endBalance: 28566.06,
        endBasis: 18000,
      },
      last: {
        year: 2079,
        contribution: 0,
        overflow: 0,
        growth: 117.74,
        endBalance: 1799.81,
        endBasis: 29.37,
      },
    });
  });
});
