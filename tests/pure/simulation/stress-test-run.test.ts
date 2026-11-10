import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { runStressTestScenarios } from "@/lib/pure/simulation/stress-test-run";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";

type ProjectionInputArg = Parameters<
  typeof runStressTestScenarios
>[0]["baseEngineInput"];

describe("runStressTestScenarios (M2)", () => {
  const AS_OF = new Date("2026-01-01");

  it("keeps the household's gap between the two inflation rates", () => {
    const run = (inflationRate: number, postRetirementInflationRate: number) =>
      runStressTestScenarios({
        baseEngineInput: {
          ...makeBaseInput(),
          inflationRate,
          postRetirementInflationRate,
        } as ProjectionInputArg,
        decumulationDefaults: makeDecumulationDefaults(),
      } as never).map((r) => r.sustainableWithdrawal);
    // The scenario sets inflation, so plans with one gap read the same.
    expect(run(0.03, 0.02)).toEqual(run(0.035, 0.025));
  });

  function makeBaseInput(): Omit<
    ProjectionInput,
    "decumulationDefaults" | "accumulationOverrides" | "decumulationOverrides"
  > {
    return withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.15,
        accountOrder: ["401k", "hsa", "ira", "brokerage"],
        accountSplits: {
          "401k": 0.5,
          "403b": 0,
          hsa: 0.1,
          ira: 0.1,
          brokerage: 0.3,
        },
      }),
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
    });
  }

  const distributionTaxRates = {
    ...shippedTaxTables(),
    traditionalFallbackRate: 0.22,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
  };

  /** `runStressTestScenarios` now takes a fully-resolved
   *  `decumulationDefaults` (the caller — stress-test.ts — builds it via
   *  `buildDecumulationDefaults`; this helper only overrides
   *  `withdrawalRate` per scenario) instead of the old hand-picked
   *  `userStrategyParams`/`activeStrategy` pair — those two hardcoded the
   *  household's RMD/QCD/discretionary-order settings to engine defaults
   *  regardless of what was configured. `withdrawalRate` here is a placeholder — every
   *  scenario overrides it. */
  function makeDecumulationDefaults(
    overrides: Partial<ProjectionInput["decumulationDefaults"]> = {},
  ): ProjectionInput["decumulationDefaults"] {
    return {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "bracket_filling",
      withdrawalOrder: [],
      // bracket_filling doesn't read splits.
      withdrawalSplits: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
      withdrawalTaxPreference: {},
      distributionTaxRates,
      withdrawalStrategy: "fixed",
      strategyParams: { fixed: {} },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a scenario's salary growth applies to everyone, whatever each person's own rate", () => {
    const twoEarners = {
      ...makeBaseInput(),
      salaryByPerson: { 1: 60000, 2: 40000 },
      currentSalary: 100000,
    };
    const nestEggs = (input: ProjectionInputArg) =>
      runStressTestScenarios({
        baseEngineInput: input,
        decumulationDefaults: makeDecumulationDefaults(),
      }).map((r) => r.nestEggAtRetirement);
    expect(
      nestEggs({ ...twoEarners, salaryGrowthRateByPerson: { 1: 0.09, 2: 0 } }),
    ).toEqual(nestEggs(twoEarners));
  });

  it("returns one result per canonical scenario (conservative/baseline/optimistic)", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      decumulationDefaults: makeDecumulationDefaults(),
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
      decumulationDefaults: makeDecumulationDefaults(),
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
      decumulationDefaults: makeDecumulationDefaults(),
    });
    const conservative = results.find(
      (r) => r.label === "Conservative stress test",
    )!;
    const optimistic = results.find((r) => r.label === "Optimistic baseline")!;
    // 30 years compounding — optimistic (9%) should beat conservative (5%).
    expect(optimistic.nestEggAtRetirement).toBeGreaterThan(
      conservative.nestEggAtRetirement,
    );
    // sustainableWithdrawal no longer tracks nestEggAtRetirement here: for
    // the "fixed" strategy under test,
    // sustainableWithdrawal is the strategy's actual first decumulation
    // year withdrawal, not a `balance × withdrawalRate` reference figure.
    // makeBaseInput() sets no `decumulationAnnualExpenses`, so year-1
    // spending is whatever accumulation-phase `annualExpenses` inflates to
    // by retirement — 30 years compounded at each SCENARIO's OWN
    // inflationRate (conservative 4% vs optimistic 2%, see
    // lib/pure/simulation/stress-test.ts). Higher assumed inflation produces a bigger
    // nominal-dollar year-1 budget regardless of portfolio size, so
    // conservative's sustainableWithdrawal is correctly LARGER than
    // optimistic's here — the opposite of nestEggAtRetirement's ordering,
    // and no longer meaningfully comparable to it.
    expect(conservative.sustainableWithdrawal).toBeGreaterThan(
      optimistic.sustainableWithdrawal,
    );
  });

  it("every result has a non-negative nest egg and sustainable withdrawal", () => {
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      decumulationDefaults: makeDecumulationDefaults(),
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
        retirementYear: AS_OF.getFullYear() - 3,
      },
      decumulationDefaults: makeDecumulationDefaults(),
    });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.nestEggAtRetirement).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects non-fixed active strategies (e.g. guyton_klinger)", () => {
    // withdrawalStrategy + strategyParams on decumulationDefaults are what
    // the engine actually reads. Swap to guyton_klinger so the
    // strategy-params path is exercised rather than the trivial fixed
    // default.
    const results = runStressTestScenarios({
      baseEngineInput: makeBaseInput(),
      decumulationDefaults: makeDecumulationDefaults({
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
      }),
    });
    expect(results).toHaveLength(3);
  });
});
