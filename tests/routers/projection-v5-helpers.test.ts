import "./setup-mocks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectionInput } from "@/lib/calculators/types";
import {
  buildAccumulationOrder,
  computeStockPercentFromGlidePath,
  runStressTestScenarios,
  type GlidePathRow,
  type AssetClassRow,
} from "@/server/routers/projection-v5-helpers";

/**
 * Unit tests for the projection-v5-helpers module (v0.5 expert-review
 * M1/M2/M6). These helpers were extracted from projection.ts to keep
 * that router under the 2000-line size limit. They're pure enough to
 * test in isolation without spinning up the full router runtime.
 */

describe("buildAccumulationOrder (M1)", () => {
  it("returns empty array for empty input", () => {
    expect(buildAccumulationOrder([])).toEqual([]);
  });

  it("returns categories in allocationPriority order (lower = earlier)", () => {
    const contribs = [
      { accountType: "brokerage", allocationPriority: 40 },
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "hsa", allocationPriority: 20 },
      { accountType: "ira", allocationPriority: 30 },
    ];
    expect(buildAccumulationOrder(contribs)).toEqual([
      "401k",
      "hsa",
      "ira",
      "brokerage",
    ]);
  });

  it("deduplicates categories — multiple accounts of same type collapse", () => {
    const contribs = [
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "401k", allocationPriority: 15 }, // spouse's 401k
      { accountType: "ira", allocationPriority: 20 },
      { accountType: "ira", allocationPriority: 25 }, // spouse's ira
    ];
    expect(buildAccumulationOrder(contribs)).toEqual(["401k", "ira"]);
  });

  it("treats null/undefined allocationPriority as 0 (highest priority)", () => {
    const contribs = [
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "hsa", allocationPriority: null },
      { accountType: "ira" },
    ];
    // Both hsa (null → 0) and ira (undefined → 0) are ordered before 401k.
    // Stable sort preserves original order between equal keys, so hsa
    // comes before ira.
    const result = buildAccumulationOrder(contribs);
    expect(result.indexOf("hsa")).toBeLessThan(result.indexOf("401k"));
    expect(result.indexOf("ira")).toBeLessThan(result.indexOf("401k"));
  });
});

describe("computeStockPercentFromGlidePath (M6)", () => {
  // Pure function — takes plain rows, no db mock needed. This is the
  // testable core of the M6 glide-path lookup; the db-bound wrapper
  // (computeCurrentStockAllocationPercent) is a thin delegation that
  // the integration path exercises in production.

  it("returns null when no glide path is configured", () => {
    expect(computeStockPercentFromGlidePath([], [], 35)).toBeNull();
  });

  it("returns null when asset classes have no stock/equity entries", () => {
    const gp: GlidePathRow[] = [
      { age: 30, assetClassId: 1, allocation: "1.0" },
    ];
    const classes: AssetClassRow[] = [{ id: 1, name: "US Bonds" }];
    expect(computeStockPercentFromGlidePath(gp, classes, 35)).toBeNull();
  });

  it("sums equity allocations at the exact age when a glide path row matches", () => {
    const gp: GlidePathRow[] = [
      { age: 35, assetClassId: 1, allocation: "0.6" }, // US Equities
      { age: 35, assetClassId: 2, allocation: "0.3" }, // International Equities
      { age: 35, assetClassId: 3, allocation: "0.1" }, // Bonds
    ];
    const classes: AssetClassRow[] = [
      { id: 1, name: "US Equities" },
      { id: 2, name: "International Equities" },
      { id: 3, name: "US Bonds" },
    ];
    // 0.6 + 0.3 = 0.9 → 90.0%
    expect(computeStockPercentFromGlidePath(gp, classes, 35)).toBeCloseTo(
      90.0,
      1,
    );
  });

  it("interpolates between two bracket ages when current age is in between", () => {
    const gp: GlidePathRow[] = [
      { age: 30, assetClassId: 1, allocation: "0.8" },
      { age: 40, assetClassId: 1, allocation: "0.4" },
      { age: 30, assetClassId: 2, allocation: "0.2" },
      { age: 40, assetClassId: 2, allocation: "0.6" },
    ];
    const classes: AssetClassRow[] = [
      { id: 1, name: "US Equities" },
      { id: 2, name: "US Bonds" },
    ];
    // At age 35 (halfway), stock allocation should interpolate:
    // US Equities: 0.8 + (0.4 - 0.8) * 0.5 = 0.6 → 60%
    expect(computeStockPercentFromGlidePath(gp, classes, 35)).toBeCloseTo(
      60.0,
      1,
    );
  });

  it("clamps to the earliest bracket for ages below the glide path start", () => {
    const gp: GlidePathRow[] = [
      { age: 40, assetClassId: 1, allocation: "0.7" },
      { age: 50, assetClassId: 1, allocation: "0.5" },
    ];
    const classes: AssetClassRow[] = [{ id: 1, name: "US Equities" }];
    expect(computeStockPercentFromGlidePath(gp, classes, 25)).toBeCloseTo(
      70.0,
      1,
    );
  });

  it("clamps to the latest bracket for ages above the glide path end", () => {
    const gp: GlidePathRow[] = [
      { age: 40, assetClassId: 1, allocation: "0.7" },
      { age: 50, assetClassId: 1, allocation: "0.5" },
    ];
    const classes: AssetClassRow[] = [{ id: 1, name: "US Equities" }];
    expect(computeStockPercentFromGlidePath(gp, classes, 70)).toBeCloseTo(
      50.0,
      1,
    );
  });
});

describe("runStressTestScenarios (M2)", () => {
  const AS_OF = new Date("2026-01-01");

  function makeBaseInput(): Omit<
    ProjectionInput,
    "decumulationDefaults" | "accumulationOverrides" | "decumulationOverrides"
  > {
    return {
      accumulationDefaults: {
        contributionRate: 0.15,
        routingMode: "waterfall",
        accountOrder: ["401k", "hsa", "ira", "brokerage"],
        accountSplits: {
          "401k": 0.5,
          "403b": 0,
          hsa: 0.1,
          ira: 0.1,
          brokerage: 0.3,
        },
        taxSplits: { "401k": 0.5, ira: 1.0 },
      },
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
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
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
        brokerage: {
          structure: "basis_tracking",
          balance: 30000,
          basis: 20000,
        },
      },
      annualExpenses: 72000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
    };
  }

  const distributionTaxRates = {
    traditionalFallbackRate: 0.22,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns one result per canonical scenario (conservative/baseline/optimistic)", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      userStrategyParams: { fixed: {} },
      activeStrategy: "fixed",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.label)).toEqual([
      "Conservative stress test",
      "Long-run baseline",
      "Optimistic baseline",
    ]);
  });

  it("each result carries the scenario's return/inflation/salary/withdrawal rates", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      userStrategyParams: { fixed: {} },
      activeStrategy: "fixed",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    // Conservative: 5% return, 4% inflation, 0% salary, 3.5% withdrawal
    const conservative = results[0]!;
    expect(conservative.returnRate).toBe(0.05);
    expect(conservative.inflationRate).toBe(0.04);
    expect(conservative.salaryGrowthRate).toBe(0);
    expect(conservative.withdrawalRate).toBe(0.035);
    // Optimistic: 9% return, 2% inflation, 2% salary, 4% withdrawal
    const optimistic = results[2]!;
    expect(optimistic.returnRate).toBe(0.09);
    expect(optimistic.inflationRate).toBe(0.02);
    expect(optimistic.salaryGrowthRate).toBe(0.02);
    expect(optimistic.withdrawalRate).toBe(0.04);
  });

  it("optimistic scenario produces a larger nest egg than conservative", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      userStrategyParams: { fixed: {} },
      activeStrategy: "fixed",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    const conservative = results.find(
      (r) => r.label === "Conservative stress test",
    )!;
    const optimistic = results.find((r) => r.label === "Optimistic baseline")!;
    // 30 years compounding — optimistic (9%) should beat conservative (5%).
    expect(optimistic.nestEggAtRetirement).toBeGreaterThan(
      conservative.nestEggAtRetirement,
    );
    expect(optimistic.sustainableWithdrawal).toBeGreaterThan(
      conservative.sustainableWithdrawal,
    );
  });

  it("every result has a non-negative nest egg and sustainable withdrawal", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      userStrategyParams: { fixed: {} },
      activeStrategy: "fixed",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    for (const r of results) {
      expect(r.nestEggAtRetirement).toBeGreaterThanOrEqual(0);
      expect(r.sustainableWithdrawal).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles already-retired users (currentAge >= retirementAge)", () => {
    // When the user is already in decumulation, the helper falls back to
    // projectionByYear[0] for the nest-egg reading instead of searching
    // for the retirement age row. Exercise that branch so it's covered.
    const base = makeBaseInput();
    const results = runStressTestScenarios({
      baseEngineInput: {
        ...base,
        currentAge: 68,
        retirementAge: 65,
      },
      userStrategyParams: { fixed: {} },
      activeStrategy: "fixed",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.nestEggAtRetirement).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects non-fixed active strategies (e.g. guyton_klinger)", () => {
    // The activeStrategy + userStrategyParams are plumbed through into
    // decumulationDefaults.strategyParams. Swap to guyton_klinger so the
    // strategy-params path is exercised rather than the trivial fixed
    // default.
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      userStrategyParams: {
        guyton_klinger: {
          upperGuardrail: 0.8,
          lowerGuardrail: 1.2,
          increasePercent: 0.1,
          decreasePercent: 0.1,
          skipInflationAfterLoss: true,
        },
      },
      activeStrategy: "guyton_klinger",
      distributionTaxRates,
      avgRetirementAge: 65,
    });
    expect(results).toHaveLength(3);
  });
});
