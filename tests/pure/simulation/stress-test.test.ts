/**
 * Tests for stress-test and withdrawal-strategy-recommendation.
 * Two small modules tested together since they're all UI-feeding helpers.
 */
import { describe, it, expect } from "vitest";
import {
  STRESS_TEST_CONSERVATIVE,
  STRESS_TEST_OPTIMISTIC,
  STRESS_TEST_BASELINE,
  getStressTestScenarios,
  detectRosyAssumptions,
} from "@/lib/pure/simulation/stress-test";
import {
  recommendWithdrawalStrategy,
  type PlanCharacteristics,
} from "@/lib/pure/retirement/withdrawal-strategy-recommendation";

// ── Stress test parameter sets ──────────────────────────────────────

describe("STRESS_TEST scenarios", () => {
  const rosy = (p: typeof STRESS_TEST_BASELINE) =>
    detectRosyAssumptions(p.returnRate, p.inflationRate, p.salaryGrowthRate);

  it("only the optimistic scenario trips the rosy-assumption warnings", () => {
    expect(rosy(STRESS_TEST_CONSERVATIVE)).toEqual([]);
    expect(rosy(STRESS_TEST_BASELINE)).toEqual([]);
    expect(rosy(STRESS_TEST_OPTIMISTIC).map((f) => f.field)).toEqual(
      expect.arrayContaining(["returnRate", "inflationRate"]),
    );
  });

  it("conservative is harsher than baseline on every lever", () => {
    expect(STRESS_TEST_CONSERVATIVE.returnRate).toBeLessThan(
      STRESS_TEST_BASELINE.returnRate,
    );
    expect(STRESS_TEST_CONSERVATIVE.inflationRate).toBeGreaterThan(
      STRESS_TEST_BASELINE.inflationRate,
    );
    expect(STRESS_TEST_CONSERVATIVE.salaryGrowthRate).toBeLessThan(
      STRESS_TEST_BASELINE.salaryGrowthRate,
    );
    expect(STRESS_TEST_CONSERVATIVE.withdrawalRate).toBeLessThan(
      STRESS_TEST_BASELINE.withdrawalRate,
    );
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
    expect(r.strategy).toBe("guyton_klinger");
    expect(r.rationale).toMatch(/sequence/i);
  });

  it("recommends Vanguard Dynamic for 20-29 years + budget link", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 25,
      hasBudgetLink: true,
    });
    expect(r.strategy).toBe("vanguard_dynamic");
  });

  it("recommends Guyton-Klinger for 20-29 years without budget link", () => {
    const r = recommendWithdrawalStrategy({
      ...base,
      retirementHorizonYears: 25,
      hasBudgetLink: false,
    });
    expect(r.strategy).toBe("guyton_klinger");
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
