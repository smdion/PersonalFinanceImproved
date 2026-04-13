/**
 * Tests for stress-test, projection-bands, and withdrawal-strategy-recommendation.
 * Three small modules tested together since they're all UI-feeding helpers.
 */
import { describe, it, expect } from "vitest";
import {
  STRESS_TEST_CONSERVATIVE,
  STRESS_TEST_OPTIMISTIC,
  STRESS_TEST_BASELINE,
  getStressTestScenarios,
  detectRosyAssumptions,
} from "@/lib/pure/stress-test";
import {
  deriveProjectionBand,
  bandFractionForPortfolio,
} from "@/lib/pure/projection-bands";
import {
  recommendWithdrawalStrategy,
  type PlanCharacteristics,
} from "@/lib/pure/withdrawal-strategy-recommendation";

// ── Stress test parameter sets ──────────────────────────────────────

describe("STRESS_TEST scenarios", () => {
  it("conservative returns/inflation are tail-risk values", () => {
    expect(STRESS_TEST_CONSERVATIVE.returnRate).toBeLessThan(0.06);
    expect(STRESS_TEST_CONSERVATIVE.inflationRate).toBeGreaterThanOrEqual(0.04);
    expect(STRESS_TEST_CONSERVATIVE.salaryGrowthRate).toBe(0);
    expect(STRESS_TEST_CONSERVATIVE.withdrawalRate).toBeLessThan(0.04);
  });

  it("optimistic returns are top-quartile", () => {
    expect(STRESS_TEST_OPTIMISTIC.returnRate).toBeGreaterThanOrEqual(0.09);
    expect(STRESS_TEST_OPTIMISTIC.inflationRate).toBeLessThanOrEqual(0.025);
  });

  it("baseline matches long-run averages", () => {
    expect(STRESS_TEST_BASELINE.returnRate).toBe(0.07);
    expect(STRESS_TEST_BASELINE.inflationRate).toBe(0.03);
  });

  it("getStressTestScenarios returns conservative→baseline→optimistic order", () => {
    const scenarios = getStressTestScenarios();
    expect(scenarios.length).toBe(3);
    expect(scenarios[0]?.returnRate).toBeLessThan(scenarios[1]!.returnRate);
    expect(scenarios[1]?.returnRate).toBeLessThan(scenarios[2]!.returnRate);
  });
});

describe("detectRosyAssumptions", () => {
  it("returns no flags for default baseline values", () => {
    expect(detectRosyAssumptions(0.07, 0.03, 0.01)).toEqual([]);
  });

  it("flags returnRate > 8%", () => {
    const flags = detectRosyAssumptions(0.085, 0.03, 0.01);
    expect(flags.find((f) => f.field === "returnRate")).toBeDefined();
  });

  it("flags inflation < 2.5%", () => {
    const flags = detectRosyAssumptions(0.07, 0.02, 0.01);
    expect(flags.find((f) => f.field === "inflationRate")).toBeDefined();
  });

  it("flags salary growth > 4%", () => {
    const flags = detectRosyAssumptions(0.07, 0.03, 0.05);
    expect(flags.find((f) => f.field === "salaryGrowthRate")).toBeDefined();
  });

  it("flags multiple fields when multiple are rosy", () => {
    const flags = detectRosyAssumptions(0.1, 0.02, 0.06);
    expect(flags.length).toBe(3);
  });
});

// ── Projection bands ────────────────────────────────────────────────

describe("deriveProjectionBand", () => {
  it("returns symmetric ±25% by default", () => {
    const b = deriveProjectionBand(2_400_000);
    expect(b.point).toBe(2_400_000);
    expect(b.low).toBe(1_800_000);
    expect(b.high).toBe(3_000_000);
    expect(b.rangeFraction).toBe(0.25);
  });

  it("respects a custom range fraction", () => {
    const b = deriveProjectionBand(1_000_000, 0.4);
    expect(b.low).toBe(600_000);
    expect(b.high).toBe(1_400_000);
  });

  it("clamps low to zero on a small point", () => {
    const b = deriveProjectionBand(100, 0.99);
    expect(b.low).toBeCloseTo(1, 5);
    expect(b.low).toBeGreaterThanOrEqual(0);
  });

  it("returns 'Insufficient data' label for invalid input", () => {
    expect(deriveProjectionBand(NaN).label).toMatch(/Insufficient/);
    expect(deriveProjectionBand(-1).label).toMatch(/Insufficient/);
  });

  it("label includes compact dollar formatting", () => {
    const b = deriveProjectionBand(2_400_000);
    expect(b.label).toMatch(/\$2\.4M/);
    expect(b.label).toMatch(/\$1\.8M/);
    expect(b.label).toMatch(/\$3\.0M/);
  });
});

describe("bandFractionForPortfolio", () => {
  it("widens for long horizon + heavy equity", () => {
    expect(bandFractionForPortfolio(30, 90)).toBeGreaterThan(0.3);
  });
  it("narrows for short horizon + bond-heavy", () => {
    expect(bandFractionForPortfolio(10, 30)).toBeLessThan(0.2);
  });
  it("clamps to [0.1, 0.5]", () => {
    expect(bandFractionForPortfolio(100, 100)).toBeLessThanOrEqual(0.5);
    expect(bandFractionForPortfolio(0, 0)).toBeGreaterThanOrEqual(0.1);
  });
});

// ── Withdrawal strategy recommendation ──────────────────────────────

describe("recommendWithdrawalStrategy", () => {
  const base: PlanCharacteristics = {
    retirementHorizonYears: 30,
    hasBudgetLink: false,
    hasSocialSecurity: true,
    mostlyTaxAdvantaged: true,
  };

  it("recommends Guyton-Klinger for ≥30 year horizons", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 35,
    });
    expect(r.strategy).toBe("guyton-klinger");
    expect(r.rationale).toMatch(/sequence/i);
  });

  it("recommends Vanguard Dynamic for 20-29 years + budget link", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 25,
      hasBudgetLink: true,
    });
    expect(r.strategy).toBe("vanguard-dynamic");
  });

  it("recommends Guyton-Klinger for 20-29 years without budget link", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 25,
      hasBudgetLink: false,
    });
    expect(r.strategy).toBe("guyton-klinger");
    expect(r.rationale).toMatch(/budget/i);
  });

  it("recommends Fixed for short horizons (<20 years)", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 15,
    });
    expect(r.strategy).toBe("fixed");
    expect(r.rationale).toMatch(/Trinity/i);
  });

  it("returns a label and rationale for every recommendation", () => {
    for (const horizon of [10, 20, 25, 30, 40]) {
      const r = recommendWithdrawalStrategy({
        ...base,
        retirementHorizonYears: horizon,
      });
      expect(r.label).toBeTruthy();
      expect(r.rationale.length).toBeGreaterThan(20);
    }
  });
});
