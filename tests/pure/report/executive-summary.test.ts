/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal ProjectionResult/MonteCarloResult fixtures without satisfying every unrelated field of the full engine types */
import { describe, it, expect } from "vitest";
import {
  buildVerdict,
  buildExecutiveSummary,
} from "@/lib/pure/report/executive-summary";
import type { ProjectionResult } from "@/lib/calculators/types/engine-projection";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";

function projectionResult(
  overrides: Partial<ProjectionResult> = {},
): ProjectionResult {
  return {
    projectionByYear: [],
    firstOverflowYear: null,
    firstOverflowAge: null,
    firstOverflowAmount: null,
    portfolioDepletionYear: null,
    portfolioDepletionAge: null,
    sustainableWithdrawal: 50000,
    firstDecumulationYearStatedNeed: 48000,
    accountDepletions: [],
    warnings: [],
    ...overrides,
  } as unknown as ProjectionResult;
}

function mcResult(overrides: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    successRate: 0.9,
    spendingStabilityRate: 0.9,
    budgetStabilityRate: 0.9,
    penaltyAvoidedShortfallRate: 0,
    medianPenaltyAvoidedShortfallPV: 0,
    medianEndBalance: 500000,
    meanEndBalance: 520000,
    percentileBands: [],
    distributions: {
      terminalBalance: {
        min: 0,
        p5: 0,
        p10: 0,
        p25: 0,
        median: 500000,
        p75: 0,
        p90: 0,
        p95: 0,
        max: 0,
        mean: 0,
        stdDev: 0,
      },
      depletionAge: null,
      sustainableWithdrawal: {
        min: 0,
        p5: 0,
        p10: 0,
        p25: 0,
        median: 45000,
        p75: 0,
        p90: 0,
        p95: 0,
        max: 0,
        mean: 0,
        stdDev: 0,
      },
      sustainableWithdrawalPV: {
        min: 0,
        p5: 0,
        p10: 0,
        p25: 0,
        median: 42000,
        p75: 0,
        p90: 0,
        p95: 0,
        max: 0,
        mean: 0,
        stdDev: 0,
      },
    },
    worstCase: { p5DepletionAge: null, p5EndBalance: 100000 },
    ...overrides,
  } as unknown as MonteCarloResult;
}

describe("buildVerdict", () => {
  it("is on track when the portfolio never depletes AND the success rate clears the bar", () => {
    const v = buildVerdict(
      projectionResult({ portfolioDepletionYear: null }),
      mcResult({ successRate: 0.9 }),
    );
    expect(v.onTrack).toBe(true);
    expect(v.headline).toMatch(/on track/i);
  });

  it("is NOT on track when the deterministic projection depletes, even with a high success rate", () => {
    const v = buildVerdict(
      projectionResult({ portfolioDepletionYear: 2065 }),
      mcResult({ successRate: 0.95 }),
    );
    expect(v.onTrack).toBe(false);
    expect(v.headline).toMatch(/needs attention/i);
  });

  it("is NOT on track when the success rate is below the threshold, even with no deterministic depletion", () => {
    const v = buildVerdict(
      projectionResult({ portfolioDepletionYear: null }),
      mcResult({ successRate: 0.5 }),
    );
    expect(v.onTrack).toBe(false);
  });
});

describe("buildExecutiveSummary", () => {
  it("does not read as alarmist for a genuinely on-track plan", () => {
    const summary = buildExecutiveSummary(
      projectionResult({ portfolioDepletionYear: null }),
      mcResult({ successRate: 0.92 }),
      {},
    );
    expect(summary.verdict.onTrack).toBe(true);
    // "not projected to run out" (a reassuring, hedged negative) is fine —
    // an unqualified claim that the plan *will* deplete is not.
    expect(summary.narrative).not.toMatch(
      /portfolio is projected to (run out|be depleted)/i,
    );
  });

  it("does not read as falsely reassuring for a depleted plan", () => {
    const summary = buildExecutiveSummary(
      projectionResult({
        portfolioDepletionYear: 2060,
        portfolioDepletionAge: 78,
      }),
      mcResult({ successRate: 0.4 }),
      {},
    );
    expect(summary.verdict.onTrack).toBe(false);
    expect(summary.narrative).toMatch(/78/);
  });

  it("includes a Coast FIRE one-liner only when an age is supplied", () => {
    const withAge = buildExecutiveSummary(projectionResult(), mcResult(), {
      coastFireAge: 52,
    });
    expect(withAge.coastFireLine).toMatch(/52/);

    const withoutAge = buildExecutiveSummary(
      projectionResult(),
      mcResult(),
      {},
    );
    expect(withoutAge.coastFireLine).toBeUndefined();
  });

  it("key numbers include the simulation success rate and sustainable spending", () => {
    const summary = buildExecutiveSummary(projectionResult(), mcResult(), {});
    const labels = summary.keyNumbers.map((k) => k.label);
    expect(labels).toContain("Simulation success rate");
    expect(labels.some((l) => /sustainable/i.test(l))).toBe(true);
  });

  it("omits the depletion-age key number when the portfolio never depletes", () => {
    const summary = buildExecutiveSummary(
      projectionResult({ portfolioDepletionAge: null }),
      mcResult(),
      {},
    );
    expect(summary.keyNumbers.some((k) => /depletion age/i.test(k.label))).toBe(
      false,
    );
  });
});
