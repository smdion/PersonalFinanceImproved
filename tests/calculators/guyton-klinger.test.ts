import { describe, it, expect } from "vitest";
import {
  applyGuytonKlinger,
  applyGuytonKlingerStrategy,
} from "@/lib/calculators/engine/guyton-klinger";
import type {
  GuytonKlingerInput,
  GuytonKlingerParams,
} from "@/lib/calculators/engine/guyton-klinger";
import { initialCrossYearState } from "@/lib/calculators/engine/spending-strategy";

const DEFAULT_PARAMS: GuytonKlingerParams = {
  upperGuardrail: 0.8,
  lowerGuardrail: 1.2,
  increasePercent: 0.1,
  decreasePercent: 0.1,
  skipInflationAfterLoss: true,
};

function makeGKInput(
  overrides: Partial<GuytonKlingerInput> = {},
): GuytonKlingerInput {
  return {
    params: DEFAULT_PARAMS,
    projectedExpenses: 50000,
    portfolioBalance: 1000000,
    effectiveInflation: 0.03,
    hasBudgetOverride: false,
    isFirstDecumulationYear: false,
    yearIndex: 1,
    initialWithdrawalRate: 0.05,
    priorYearReturn: 0.07,
    ...overrides,
  };
}

describe("applyGuytonKlinger", () => {
  describe("first decumulation year", () => {
    it("captures initial withdrawal rate and returns unchanged expenses", () => {
      const result = applyGuytonKlinger(
        makeGKInput({ initialWithdrawalRate: null }),
      );
      expect(result.initialWithdrawalRate).toBeCloseTo(0.05, 4); // 50000/1000000
      expect(result.projectedExpenses).toBe(50000);
      expect(result.guardrailTriggered).toBeNull();
    });
  });

  describe("zero portfolio balance", () => {
    it("returns unchanged expenses", () => {
      const result = applyGuytonKlinger(makeGKInput({ portfolioBalance: 0 }));
      expect(result.projectedExpenses).toBe(50000);
      expect(result.guardrailTriggered).toBeNull();
    });

    it("returns unchanged expenses for negative balance", () => {
      const result = applyGuytonKlinger(
        makeGKInput({ portfolioBalance: -1000 }),
      );
      expect(result.projectedExpenses).toBe(50000);
      expect(result.guardrailTriggered).toBeNull();
    });
  });

  describe("prosperity rule (skip inflation after loss)", () => {
    it("undoes inflation after a loss year", () => {
      const result = applyGuytonKlinger(
        makeGKInput({
          priorYearReturn: -0.15,
          projectedExpenses: 51500, // 50000 * 1.03
          effectiveInflation: 0.03,
          yearIndex: 2,
        }),
      );
      // Should undo inflation: 51500 / 1.03 = 50000
      expect(result.projectedExpenses).toBeLessThan(51500);
      // May trigger "skip_inflation" or a guardrail after undoing
      expect(
        result.guardrailTriggered === "skip_inflation" ||
          result.guardrailTriggered === "increase" ||
          result.guardrailTriggered === "decrease",
      ).toBe(true);
    });

    it("does not undo inflation when skipInflationAfterLoss is false", () => {
      const result = applyGuytonKlinger(
        makeGKInput({
          params: { ...DEFAULT_PARAMS, skipInflationAfterLoss: false },
          priorYearReturn: -0.15,
          projectedExpenses: 51500,
          effectiveInflation: 0.03,
        }),
      );
      // Should NOT trigger skip_inflation
      expect(result.guardrailTriggered).not.toBe("skip_inflation");
    });

    it("does not undo inflation when hasBudgetOverride is true", () => {
      const result = applyGuytonKlinger(
        makeGKInput({
          priorYearReturn: -0.15,
          hasBudgetOverride: true,
          projectedExpenses: 51500,
          effectiveInflation: 0.03,
        }),
      );
      // Budget override takes precedence — no inflation undo
      expect(result.guardrailTriggered).not.toBe("skip_inflation");
    });

    it("does not undo inflation on year 0", () => {
      const result = applyGuytonKlinger(
        makeGKInput({
          priorYearReturn: -0.15,
          yearIndex: 0,
          projectedExpenses: 51500,
          effectiveInflation: 0.03,
        }),
      );
      expect(result.guardrailTriggered).not.toBe("skip_inflation");
    });
  });

  describe("upper guardrail (increase spending)", () => {
    it("triggers increase when currentRate < initialRate * upperGuardrail", () => {
      // currentRate = 50000/2000000 = 0.025
      // initialRate * upper = 0.05 * 0.8 = 0.04
      // 0.025 < 0.04 → increase
      const result = applyGuytonKlinger(
        makeGKInput({ portfolioBalance: 2000000 }),
      );
      expect(result.guardrailTriggered).toBe("increase");
      expect(result.projectedExpenses).toBeCloseTo(55000, -2); // 50000 * 1.1
    });
  });

  describe("lower guardrail (decrease spending)", () => {
    it("triggers decrease when currentRate > initialRate * lowerGuardrail", () => {
      // currentRate = 50000/600000 ≈ 0.0833
      // initialRate * lower = 0.05 * 1.2 = 0.06
      // 0.0833 > 0.06 → decrease
      const result = applyGuytonKlinger(
        makeGKInput({ portfolioBalance: 600000 }),
      );
      expect(result.guardrailTriggered).toBe("decrease");
      expect(result.projectedExpenses).toBeCloseTo(45000, -2); // 50000 * 0.9
    });
  });

  describe("no guardrail triggered", () => {
    it("returns unchanged expenses when within guardrail bounds", () => {
      // currentRate = 50000/1000000 = 0.05
      // upper threshold = 0.05 * 0.8 = 0.04
      // lower threshold = 0.05 * 1.2 = 0.06
      // 0.05 is between 0.04 and 0.06 → no trigger
      const result = applyGuytonKlinger(makeGKInput());
      expect(result.guardrailTriggered).toBeNull();
      expect(result.projectedExpenses).toBe(50000);
    });
  });

  describe("state management", () => {
    it("preserves initialWithdrawalRate across calls", () => {
      const result = applyGuytonKlinger(makeGKInput());
      expect(result.initialWithdrawalRate).toBe(0.05);
    });

    it("sets baseSpending to adjusted expenses", () => {
      const result = applyGuytonKlinger(
        makeGKInput({ portfolioBalance: 2000000 }),
      );
      expect(result.baseSpending).toBe(result.projectedExpenses);
    });
  });
});

describe("applyGuytonKlingerStrategy (wrapper)", () => {
  it("maps SpendingStrategyInput to GK and returns SpendingStrategyResult", () => {
    const input = {
      projectedExpenses: 50000,
      portfolioBalance: 1000000,
      effectiveInflation: 0.03,
      hasBudgetOverride: false,
      yearIndex: 0,
      age: 65,
      crossYearState: initialCrossYearState(),
    };
    const result = applyGuytonKlingerStrategy(DEFAULT_PARAMS, input);
    expect(result.projectedExpenses).toBe(50000);
    expect(result.updatedState.initialWithdrawalRate).toBe(0.05);
  });

  it("uses default params when not provided", () => {
    const input = {
      projectedExpenses: 50000,
      portfolioBalance: 2000000,
      effectiveInflation: 0.03,
      hasBudgetOverride: false,
      yearIndex: 1,
      age: 66,
      crossYearState: {
        ...initialCrossYearState(),
        initialWithdrawalRate: 0.05,
        priorYearReturn: 0.1,
      },
    };
    const result = applyGuytonKlingerStrategy({}, input);
    // Default params: upperGuardrail=0.8, so currentRate 0.025 < 0.05*0.8=0.04 → increase
    expect(result.action).toBe("increase");
  });
});
