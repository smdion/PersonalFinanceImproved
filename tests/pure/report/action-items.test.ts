/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal ProjectionResult/MonteCarloResult/EngineDecumulationYear fixtures without satisfying every unrelated field of the full engine types */
import { describe, it, expect } from "vitest";
import { buildActionItems } from "@/lib/pure/report/action-items";
import type {
  ProjectionResult,
  EngineDecumulationYear,
} from "@/lib/calculators/types/engine-projection";
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
    percentileBands: [],
    distributions: {
      terminalBalance: distribution(500000),
      depletionAge: null,
      sustainableWithdrawal: distribution(45000),
      sustainableWithdrawalPV: distribution(42000),
    },
    worstCase: { p5DepletionAge: null, p5EndBalance: 100000 },
    ...overrides,
  } as unknown as MonteCarloResult;
}

function decumYear(
  overrides: Partial<EngineDecumulationYear> = {},
): EngineDecumulationYear {
  return {
    year: 2040,
    age: 65,
    phase: "decumulation",
    rmdShortfallAmount: 0,
    acaSubsidyPreserved: true,
    ...overrides,
  } as unknown as EngineDecumulationYear;
}

describe("buildActionItems", () => {
  it("produces no items for a clean, high-success plan", () => {
    const result = buildActionItems(projectionResult(), mcResult(), []);
    expect(result.items).toHaveLength(0);
  });

  it("recommends improving success rate when below the 85% bar", () => {
    const result = buildActionItems(
      projectionResult(),
      mcResult({ successRate: 0.7 }),
      [],
    );
    expect(result.items.some((i) => /success rate/i.test(i.title))).toBe(true);
  });

  it("recommends building penalty-free money when the shortfall rate is meaningful", () => {
    const result = buildActionItems(
      projectionResult(),
      mcResult({ penaltyAvoidedShortfallRate: 0.15 }),
      [],
    );
    expect(result.items.some((i) => /penalty-free money/i.test(i.title))).toBe(
      true,
    );
  });

  it("does not recommend penalty-free money for a small, immaterial shortfall rate", () => {
    const result = buildActionItems(
      projectionResult(),
      mcResult({ penaltyAvoidedShortfallRate: 0.01 }),
      [],
    );
    expect(result.items.some((i) => /penalty-free money/i.test(i.title))).toBe(
      false,
    );
  });

  it("recommends reviewing RMD capacity when a real shortfall year exists", () => {
    const result = buildActionItems(projectionResult(), mcResult(), [
      decumYear({ rmdShortfallAmount: 5000 }),
    ]);
    expect(
      result.items.some((i) => /Required Minimum Distribution/i.test(i.title)),
    ).toBe(true);
  });

  it("recommends reviewing ACA income timing when the subsidy is lost in any year", () => {
    const result = buildActionItems(projectionResult(), mcResult(), [
      decumYear({ acaSubsidyPreserved: false }),
    ]);
    expect(result.items.some((i) => /ACA subsidy cliff/i.test(i.title))).toBe(
      true,
    );
  });

  it("passes engine warnings through verbatim as disclosures, not parsed into recommendations", () => {
    const result = buildActionItems(
      projectionResult({ warnings: ["Some engine-generated warning text"] }),
      mcResult(),
      [],
    );
    expect(result.disclosures).toEqual(["Some engine-generated warning text"]);
    // A warning string alone must never itself produce a recommendation —
    // only the structured fields above do (RULES.md single-computation-path).
    expect(result.items).toHaveLength(0);
  });
});
