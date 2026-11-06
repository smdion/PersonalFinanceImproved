import { describe, it, expect } from "vitest";
import {
  applyGuytonKlinger,
  applyGuytonKlingerStrategy,
} from "@/lib/pure/engine/guyton-klinger";
import type {
  GuytonKlingerInput,
  GuytonKlingerParams,
} from "@/lib/pure/engine/guyton-klinger";
import { initialCrossYearState } from "@/lib/pure/engine/spending-strategy";

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
    ssIncome: 0,
    effectiveInflation: 0.03,
    hasBudgetOverride: false,
    isFirstDecumulationYear: false,
    yearIndex: 1,
    initialWithdrawalRate: 0.05,
    priorYearReturn: 0.07,
    priorSsIncome: null,
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
      cpiInflation: 0.03,
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
      cpiInflation: 0.03,
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

describe("applyGuytonKlinger — the withdrawal rate is what the portfolio pays", () => {
  it("the initial rate leaves out what Social Security covers", () => {
    const r = applyGuytonKlinger(
      makeGKInput({
        initialWithdrawalRate: null,
        projectedExpenses: 80000,
        ssIncome: 30000,
      }),
    );
    expect(r.initialWithdrawalRate).toBeCloseTo(0.05);
  });

  it("Social Security covering spending isn't read as an overdrawn portfolio", () => {
    // Spending 72k on 1M with 30k of Social Security: the portfolio pays
    // 42k (4.2%) — under the 6% lower guardrail (5% × 1.2). Judged on
    // total spending (7.2%) it would have been cut.
    const r = applyGuytonKlinger(
      makeGKInput({
        projectedExpenses: 72000,
        ssIncome: 30000,
        initialWithdrawalRate: 0.05,
      }),
    );
    expect(r.guardrailTriggered).not.toBe("decrease");
    expect(r.projectedExpenses).toBe(72000);
  });

  it("Social Security above spending: the portfolio pays nothing, nothing to move", () => {
    const r = applyGuytonKlinger(
      makeGKInput({ projectedExpenses: 20000, ssIncome: 30000 }),
    );
    expect(r.guardrailTriggered).toBeNull();
    expect(r.projectedExpenses).toBe(20000);
  });

  it("while Social Security covers all spending, no initial rate is anchored yet", () => {
    const r = applyGuytonKlinger(
      makeGKInput({
        initialWithdrawalRate: null,
        projectedExpenses: 25000,
        ssIncome: 30000,
      }),
    );
    expect(r.initialWithdrawalRate).toBeNull();
    expect(r.guardrailTriggered).toBeNull();
    expect(r.projectedExpenses).toBe(25000);
  });

  it("a cut moves spending by its share of the portfolio draw, not of all spending", () => {
    // Portfolio pays 70k of 100k on 1M (7% > 6% lower guardrail): 10% of
    // the 70k draw comes off, not 10% of 100k.
    const r = applyGuytonKlinger(
      makeGKInput({ projectedExpenses: 100000, ssIncome: 30000 }),
    );
    expect(r.guardrailTriggered).toBe("decrease");
    expect(r.projectedExpenses).toBe(93000);
  });

  it("Social Security starting isn't market news: the anchor rescales, no raise", () => {
    // Anchor 5% on a 50k draw (no SS). SS of 20k starts: the draw falls to
    // 30k (3% < 4% upper guardrail) — without the rescale, a raise. The
    // anchor moves by the same step (5% × 30/50 = 3%), so nothing fires.
    const r = applyGuytonKlinger(
      makeGKInput({
        projectedExpenses: 50000,
        ssIncome: 20000,
        priorSsIncome: 0,
        initialWithdrawalRate: 0.05,
      }),
    );
    expect(r.initialWithdrawalRate).toBeCloseTo(0.03);
    expect(r.guardrailTriggered).toBeNull();
    expect(r.projectedExpenses).toBe(50000);
  });

  it("Social Security covering all spending: the anchor carries, no raise or cut chain after", () => {
    // 40k on 1M anchors at 4%. A 41k benefit (today's dollars, COLA'd)
    // starts in year 1 and covers all of spending for two years; a budget
    // step in year 3 has the portfolio paying again. Everything grows at
    // 2.5% and the portfolio keeps pace, so nothing changed in real terms:
    // a stale 4% anchor would read each small draw as a raise, and
    // re-anchoring on the first small draw would read growth as a cut.
    let state = { ...initialCrossYearState() };
    const actions: (string | null)[] = [];
    for (let year = 0; year <= 10; year++) {
      const factor = Math.pow(1.025, year);
      const real = year === 0 ? 40000 : year < 3 ? 41000 : 43000;
      const ssToday = year >= 1 ? 41000 : 0;
      const r = applyGuytonKlingerStrategy(DEFAULT_PARAMS, {
        projectedExpenses: real * factor,
        portfolioBalance: 1_000_000 * factor,
        ssIncome: ssToday * factor,
        ssIncomeToday: ssToday,
        ssGrowthFactor: factor,
        effectiveInflation: 0.025,
        cpiInflation: 0.025,
        hasBudgetOverride: false,
        yearIndex: year,
        age: 65 + year,
        crossYearState: { ...state, priorYearReturn: 0 },
      });
      actions.push(r.action);
      state = { ...state, ...r.updatedState };
      if (year === 1) {
        // Covered: the anchor and the Social Security it reflects both hold.
        expect(r.updatedState.initialWithdrawalRate).toBeCloseTo(0.04);
        expect(r.updatedState.priorYearSsIncome).toBe(0);
      }
    }
    expect(actions).toEqual(Array(11).fill(null));
  });

  it("a cost-of-living raise is never read as a benefit starting", () => {
    // Nominal benefit up 2.5%, the same in today's dollars: no rescale.
    const r = applyGuytonKlinger(
      makeGKInput({
        projectedExpenses: 80000,
        ssIncome: 30750,
        ssIncomeToday: 30000,
        ssGrowthFactor: 1.025,
        priorSsIncome: 30000,
        initialWithdrawalRate: 0.05,
      }),
    );
    expect(r.initialWithdrawalRate).toBe(0.05);
  });

  it("a second person's benefit starting still rescales, at this year's prices", () => {
    // 20k today's joined by 15k, with prices up 20%: the draw goes from
    // 100 − 24 = 76k to 100 − 42 = 58k.
    const r = applyGuytonKlinger(
      makeGKInput({
        projectedExpenses: 100000,
        portfolioBalance: 1_500_000,
        ssIncome: 42000,
        ssIncomeToday: 35000,
        ssGrowthFactor: 1.2,
        priorSsIncome: 20000,
        initialWithdrawalRate: 0.05,
      }),
    );
    expect(r.initialWithdrawalRate).toBeCloseTo(0.05 * (58 / 76));
    expect(r.ssIncomeJudged).toBe(35000);
  });

  it("after the rescale the market still counts: a fallen portfolio still cuts", () => {
    const r = applyGuytonKlinger(
      makeGKInput({
        projectedExpenses: 50000,
        ssIncome: 20000,
        priorSsIncome: 0,
        initialWithdrawalRate: 0.05,
        portfolioBalance: 700000, // 30k / 700k = 4.3% > 3% × 1.2
      }),
    );
    expect(r.guardrailTriggered).toBe("decrease");
  });
});
