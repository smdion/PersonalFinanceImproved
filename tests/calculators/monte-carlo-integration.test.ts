/**
 * Monte Carlo consumer integration snapshot tests.
 *
 * Exercises the full pipeline: engine input -> calculateMonteCarlo() -> snapshot.
 * Uses a fixed seed for deterministic results.
 * After engine refactoring, these must produce byte-identical results.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import type { ProjectionInput, MonteCarloInput } from "@/lib/calculators/types";

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

/** Extract a compact summary from Monte Carlo results for snapshot comparison. */
function extractSummary(result: ReturnType<typeof calculateMonteCarlo>) {
  const bands = result.percentileBands;
  return roundDeep({
    successRate: result.successRate,
    medianEndBalance: result.medianEndBalance,
    meanEndBalance: result.meanEndBalance,
    worstCase: result.worstCase,
    numTrials: result.numTrials,
    warningCount: result.warnings.length,
    distributions: result.distributions,
    // Band bookends: first and last year only (full array is too large for snapshots)
    firstBand: bands.length > 0 ? bands[0] : null,
    lastBand: bands.length > 0 ? bands[bands.length - 1] : null,
    totalBands: bands.length,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("monte carlo integration", () => {
  it("fixture 1: basic monte carlo — 2 asset classes, simple glide path", () => {
    const engineInput = makeInput();

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.8, 2: 0.2 } },
        { age: 65, allocations: { 1: 0.4, 2: 0.6 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(result.percentileBands.length).toBeGreaterThan(0);
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);

    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 2: with inflation risk — adds inflation randomization", () => {
    const engineInput = makeInput();

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.8, 2: 0.2 } },
        { age: 65, allocations: { 1: 0.4, 2: 0.6 } },
      ],
      inflationRisk: {
        meanRate: 0.03,
        stdDev: 0.015,
      },
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 3: conservative allocation — heavy bond weighting", () => {
    const engineInput = makeInput({
      currentSalary: 120000,
      annualExpenses: 55000,
    });

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.4, 2: 0.6 } },
        { age: 65, allocations: { 1: 0.2, 2: 0.8 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 4: near-retirement — older person with short projection", () => {
    const engineInput = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 180000,
      startingBalances: {
        preTax: 800000,
        taxFree: 300000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 60000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 600000,
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
          basis: 120000,
        },
      },
      annualExpenses: 80000,
    });

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 60, allocations: { 1: 0.5, 2: 0.5 } },
        { age: 65, allocations: { 1: 0.35, 2: 0.65 } },
        { age: 80, allocations: { 1: 0.2, 2: 0.8 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    // Near-retirement with large balances should have high success rate
    expect(result.successRate).toBeGreaterThan(0);
    expect(extractSummary(result)).toMatchSnapshot();
  });
});
