/**
 * Tests for withdrawal strategy recommendation heuristic.
 * Covers: recommendWithdrawalStrategy.
 */
import { describe, it, expect } from "vitest";
import {
  recommendWithdrawalStrategy,
  type PlanCharacteristics,
} from "@/lib/pure/withdrawal-strategy-recommendation";

const basePlan: PlanCharacteristics = {
  retirementHorizonYears: 25,
  hasBudgetLink: false,
  hasSocialSecurity: false,
  mostlyTaxAdvantaged: false,
};

describe("recommendWithdrawalStrategy", () => {
  it("recommends Guyton-Klinger for a 30+ year horizon", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 30,
    });
    expect(rec.strategy).toBe("guyton-klinger");
    expect(rec.label).toBe("Guyton-Klinger guardrails");
    expect(rec.rationale).toMatch(/30\+ year/);
  });

  it("recommends Guyton-Klinger for a well-above-30 year horizon", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 45,
    });
    expect(rec.strategy).toBe("guyton-klinger");
  });

  it("recommends Vanguard Dynamic for 20-29 years with a budget link", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 25,
      hasBudgetLink: true,
    });
    expect(rec.strategy).toBe("vanguard-dynamic");
    expect(rec.label).toBe("Vanguard Dynamic Spending");
    expect(rec.rationale).toMatch(/budget linked/);
  });

  it("recommends Guyton-Klinger for 20-29 years without a budget link", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 25,
      hasBudgetLink: false,
    });
    expect(rec.strategy).toBe("guyton-klinger");
    expect(rec.rationale).toMatch(/20–30 year horizon/);
  });

  it("recommends Fixed for a sub-20-year horizon", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 19,
    });
    expect(rec.strategy).toBe("fixed");
    expect(rec.label).toBe("Fixed (4% rule)");
    expect(rec.rationale).toMatch(/sub-20-year horizon/);
  });

  it("recommends Fixed for a very short horizon", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 5,
    });
    expect(rec.strategy).toBe("fixed");
  });

  it("recommends Fixed for a zero-year horizon", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 0,
    });
    expect(rec.strategy).toBe("fixed");
  });

  it("recommends Fixed for a negative horizon (defensive)", () => {
    const rec = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: -5,
    });
    expect(rec.strategy).toBe("fixed");
  });

  // Boundary tests around the 20 and 30 year cutoffs.
  describe("horizon boundaries", () => {
    it("horizon 19: Fixed (below 20-29 band)", () => {
      expect(
        recommendWithdrawalStrategy({ ...basePlan, retirementHorizonYears: 19 })
          .strategy,
      ).toBe("fixed");
    });
    it("horizon 20: enters 20-29 band (Guyton-Klinger, no budget link)", () => {
      expect(
        recommendWithdrawalStrategy({ ...basePlan, retirementHorizonYears: 20 })
          .strategy,
      ).toBe("guyton-klinger");
    });
    it("horizon 20 with budget link: Vanguard Dynamic", () => {
      expect(
        recommendWithdrawalStrategy({
          ...basePlan,
          retirementHorizonYears: 20,
          hasBudgetLink: true,
        }).strategy,
      ).toBe("vanguard-dynamic");
    });
    it("horizon 29: still in 20-29 band (Guyton-Klinger, no budget link)", () => {
      expect(
        recommendWithdrawalStrategy({ ...basePlan, retirementHorizonYears: 29 })
          .strategy,
      ).toBe("guyton-klinger");
    });
    it("horizon 30: crosses into 30+ band (Guyton-Klinger regardless of budget link)", () => {
      expect(
        recommendWithdrawalStrategy({
          ...basePlan,
          retirementHorizonYears: 30,
          hasBudgetLink: true,
        }).strategy,
      ).toBe("guyton-klinger");
    });
  });

  it("hasSocialSecurity and mostlyTaxAdvantaged do not affect the current heuristic", () => {
    // The decision tree only reads retirementHorizonYears and hasBudgetLink today.
    // Documenting current behavior — these fields are part of the interface for
    // future use but are not yet consulted.
    const withFlags = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 25,
      hasSocialSecurity: true,
      mostlyTaxAdvantaged: true,
    });
    const withoutFlags = recommendWithdrawalStrategy({
      ...basePlan,
      retirementHorizonYears: 25,
      hasSocialSecurity: false,
      mostlyTaxAdvantaged: false,
    });
    expect(withFlags.strategy).toBe(withoutFlags.strategy);
  });

  it("always returns a non-empty label and rationale", () => {
    const rec = recommendWithdrawalStrategy(basePlan);
    expect(rec.label.length).toBeGreaterThan(0);
    expect(rec.rationale.length).toBeGreaterThan(0);
  });
});
