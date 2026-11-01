/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal MonteCarloResult fixtures without satisfying every unrelated field of the full engine type */
import { describe, it, expect } from "vitest";
import {
  buildRiskNarrative,
  buildRiskBandPoints,
} from "@/lib/pure/report/risk-narrative";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";

function distribution(median: number) {
  return {
    min: 0,
    p5: 0,
    p10: 0,
    p25: 0,
    median,
    p75: 0,
    p90: 0,
    p95: 0,
    max: 0,
    mean: 0,
    stdDev: 0,
  };
}

function mcResult(overrides: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    successRate: 0.9,
    spendingStabilityRate: 0.95,
    budgetStabilityRate: 0.95,
    penaltyAvoidedShortfallRate: 0,
    medianPenaltyAvoidedShortfallPV: 0,
    medianEndBalance: 500000,
    meanEndBalance: 520000,
    percentileBands: [
      {
        year: 2040,
        age: 65,
        p5: 100,
        p10: 200,
        p25: 300,
        p50: 400,
        p75: 500,
        p90: 600,
        p95: 700,
        mean: 400,
      },
      {
        year: 2041,
        age: 66,
        p5: 90,
        p10: 190,
        p25: 290,
        p50: 390,
        p75: 490,
        p90: 590,
        p95: 690,
        mean: 390,
      },
    ],
    distributions: {
      terminalBalance: distribution(500000),
      failureAge: null,
      sustainableWithdrawal: distribution(45000),
      sustainableWithdrawalPV: distribution(42000),
    },
    worstCase: { p5FailureAge: null, p5EndBalance: 100000 },
    today: {
      percentileBands: [
        {
          year: 2040,
          age: 65,
          p5: 50,
          p10: 100,
          p25: 150,
          p50: 200,
          p75: 250,
          p90: 300,
          p95: 350,
          mean: 200,
        },
      ],
      terminalBalance: distribution(250000),
      medianEndBalance: 250000,
      p5EndBalance: 50000,
    },
    ...overrides,
  } as unknown as MonteCarloResult;
}

describe("buildRiskNarrative", () => {
  it("reads as reassuring for a high success rate", () => {
    const r = buildRiskNarrative(mcResult({ successRate: 0.92 }));
    expect(r.successRateNarrative).toMatch(/strong result/i);
  });

  it("reads as a real warning, not softened, for a low success rate", () => {
    const r = buildRiskNarrative(mcResult({ successRate: 0.5 }));
    expect(r.successRateNarrative).toMatch(/below the 85% threshold/i);
    expect(r.successRateNarrative).toMatch(/50%/);
  });

  it("describes a real worst-case depletion age when one exists", () => {
    const r = buildRiskNarrative(
      mcResult({ worstCase: { p5FailureAge: 80, p5EndBalance: 0 } }),
    );
    expect(r.worstCaseNarrative).toMatch(/80/);
    expect(r.worstCaseNarrative).toMatch(/worst 5%/i);
  });

  it("does not claim depletion when the worst case never depletes — reports the balance instead", () => {
    const r = buildRiskNarrative(
      mcResult({ worstCase: { p5FailureAge: null, p5EndBalance: 250000 } }),
    );
    expect(r.worstCaseNarrative).not.toMatch(/depleted/i);
    expect(r.worstCaseNarrative).toMatch(/not projected to run out/i);
  });

  it("adds a spending-stability note only when stability is meaningfully below the bar", () => {
    const stable = buildRiskNarrative(
      mcResult({ spendingStabilityRate: 0.95 }),
    );
    expect(stable.spendingStabilityNarrative).toBeUndefined();

    const unstable = buildRiskNarrative(
      mcResult({ spendingStabilityRate: 0.6 }),
    );
    expect(unstable.spendingStabilityNarrative).toBeDefined();
  });
});

describe("buildRiskBandPoints", () => {
  it("maps today's-dollar p10/p90/p50 to low/high/median per year", () => {
    const points = buildRiskBandPoints(mcResult());
    expect(points).toEqual([
      { year: 2040, age: 65, low: 100, high: 300, median: 200 },
    ]);
  });
});
