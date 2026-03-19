/**
 * Unit tests for spending strategy engine modules.
 *
 * Each strategy is tested in isolation with the common SpendingStrategyInput interface.
 */
import { describe, it, expect } from "vitest";
import { applyForgoInflation } from "@/lib/calculators/engine/forgo-inflation";
import { applySpendingDecline } from "@/lib/calculators/engine/spending-decline";
import { applyConstantPercentage } from "@/lib/calculators/engine/constant-percentage";
import { applyEndowment } from "@/lib/calculators/engine/endowment";
import { applyVanguardDynamic } from "@/lib/calculators/engine/vanguard-dynamic";
import { applyRmdSpending } from "@/lib/calculators/engine/rmd-spending";
import {
  applySpendingStrategy,
  initialCrossYearState,
} from "@/lib/calculators/engine/spending-strategy";
import type {
  SpendingStrategyInput,
  SpendingCrossYearState,
} from "@/lib/calculators/engine/spending-strategy";

function makeInput(
  overrides: Partial<SpendingStrategyInput> = {},
): SpendingStrategyInput {
  return {
    projectedExpenses: 50000,
    portfolioBalance: 1000000,
    effectiveInflation: 0.03,
    hasBudgetOverride: false,
    yearIndex: 1,
    age: 66,
    crossYearState: initialCrossYearState(),
    ...overrides,
  };
}

function stateWith(
  overrides: Partial<SpendingCrossYearState>,
): SpendingCrossYearState {
  return { ...initialCrossYearState(), ...overrides };
}

// ---------------------------------------------------------------------------
// Forgo Inflation After Loss
// ---------------------------------------------------------------------------

describe("forgo_inflation_after_loss", () => {
  it("captures initial amount on first year", () => {
    const result = applyForgoInflation({}, makeInput());
    expect(result.projectedExpenses).toBe(50000);
    expect(result.updatedState.initialWithdrawalAmount).toBe(50000);
    expect(result.action).toBeNull();
  });

  it("skips inflation after a loss year", () => {
    const input = makeInput({
      projectedExpenses: 51500, // already inflated by orchestrator
      effectiveInflation: 0.03,
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        priorYearReturn: -0.1,
      }),
    });
    const result = applyForgoInflation({}, input);
    expect(result.projectedExpenses).toBeCloseTo(51500 / 1.03, 2);
    expect(result.action).toBe("skip_inflation");
  });

  it("does NOT skip inflation after a gain year", () => {
    const input = makeInput({
      projectedExpenses: 51500,
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        priorYearReturn: 0.08,
      }),
    });
    const result = applyForgoInflation({}, input);
    expect(result.projectedExpenses).toBe(51500);
    expect(result.action).toBeNull();
  });

  it("does not skip inflation if budget override active", () => {
    const input = makeInput({
      projectedExpenses: 51500,
      hasBudgetOverride: true,
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        priorYearReturn: -0.1,
      }),
    });
    const result = applyForgoInflation({}, input);
    expect(result.projectedExpenses).toBe(51500);
    expect(result.action).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spending Decline
// ---------------------------------------------------------------------------

describe("spending_decline", () => {
  it("captures initial amount on first year", () => {
    const result = applySpendingDecline(
      { annualDeclineRate: 0.02 },
      makeInput(),
    );
    expect(result.projectedExpenses).toBe(50000);
    expect(result.updatedState.initialWithdrawalAmount).toBe(50000);
    expect(result.updatedState.decumulationYearCount).toBe(1);
  });

  it("5-year compound decline matches formula", () => {
    const initial = 50000;
    const rate = 0.02;
    const yearCount = 5;
    const input = makeInput({
      crossYearState: stateWith({
        initialWithdrawalAmount: initial,
        decumulationYearCount: yearCount,
      }),
    });
    const result = applySpendingDecline({ annualDeclineRate: rate }, input);
    const expected = initial * Math.pow(1 - rate, yearCount);
    expect(result.projectedExpenses).toBeCloseTo(expected, 2);
    expect(result.action).toBe("decline");
  });

  it("increments year count", () => {
    const input = makeInput({
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        decumulationYearCount: 3,
      }),
    });
    const result = applySpendingDecline({ annualDeclineRate: 0.02 }, input);
    expect(result.updatedState.decumulationYearCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Constant Percentage
// ---------------------------------------------------------------------------

describe("constant_percentage", () => {
  it("first year sets initial amount", () => {
    const result = applyConstantPercentage(
      { withdrawalPercent: 0.05, floorPercent: 0.9 },
      makeInput(),
    );
    expect(result.projectedExpenses).toBe(50000); // 1M * 5%
    expect(result.updatedState.initialWithdrawalAmount).toBe(50000);
  });

  it("withdraws percentage of current balance", () => {
    const input = makeInput({
      portfolioBalance: 1200000,
      crossYearState: stateWith({ initialWithdrawalAmount: 50000 }),
    });
    const result = applyConstantPercentage(
      { withdrawalPercent: 0.05, floorPercent: 0.9 },
      input,
    );
    expect(result.projectedExpenses).toBe(60000); // 1.2M * 5%
    expect(result.action).toBeNull();
  });

  it("floor activates when balance drops significantly", () => {
    const input = makeInput({
      portfolioBalance: 400000, // 400k * 5% = 20k, but floor = 50k * 90% = 45k
      crossYearState: stateWith({ initialWithdrawalAmount: 50000 }),
    });
    const result = applyConstantPercentage(
      { withdrawalPercent: 0.05, floorPercent: 0.9 },
      input,
    );
    expect(result.projectedExpenses).toBe(45000);
    expect(result.action).toBe("floor_applied");
  });
});

// ---------------------------------------------------------------------------
// Endowment
// ---------------------------------------------------------------------------

describe("endowment", () => {
  it("first year sets initial amount and pushes balance history", () => {
    const result = applyEndowment(
      { withdrawalPercent: 0.05, rollingYears: 10, floorPercent: 0.9 },
      makeInput(),
    );
    expect(result.projectedExpenses).toBe(50000);
    expect(result.updatedState.balanceHistory).toEqual([1000000]);
  });

  it("rolling average smooths a volatile sequence", () => {
    // 5-year history with volatility, current balance of 1.1M
    const history = [1000000, 900000, 1100000, 950000, 1050000];
    const input = makeInput({
      portfolioBalance: 1100000,
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        balanceHistory: history,
      }),
    });
    const result = applyEndowment(
      { withdrawalPercent: 0.05, rollingYears: 10, floorPercent: 0.9 },
      input,
    );
    // Rolling avg of 6 values: (1000k + 900k + 1100k + 950k + 1050k + 1100k) / 6 = 1016667
    const expectedAvg =
      (1000000 + 900000 + 1100000 + 950000 + 1050000 + 1100000) / 6;
    const expectedSpending = expectedAvg * 0.05;
    expect(result.projectedExpenses).toBeCloseTo(expectedSpending, 0);
    expect(result.action).toBeNull();
  });

  it("floor applies when rolling average is low", () => {
    const input = makeInput({
      portfolioBalance: 300000,
      crossYearState: stateWith({
        initialWithdrawalAmount: 50000,
        balanceHistory: [300000, 300000, 300000],
      }),
    });
    const result = applyEndowment(
      { withdrawalPercent: 0.05, rollingYears: 10, floorPercent: 0.9 },
      input,
    );
    // Avg of 4 values = 300k, 300k * 5% = 15k < floor of 45k
    expect(result.projectedExpenses).toBe(45000);
    expect(result.action).toBe("floor_applied");
  });
});

// ---------------------------------------------------------------------------
// Vanguard Dynamic
// ---------------------------------------------------------------------------

describe("vanguard_dynamic", () => {
  it("first year sets baseline (no clamping)", () => {
    const result = applyVanguardDynamic(
      { basePercent: 0.05, ceilingPercent: 0.05, floorPercent: 0.025 },
      makeInput(),
    );
    expect(result.projectedExpenses).toBe(50000);
    expect(result.updatedState.priorYearSpending).toBe(50000);
    expect(result.action).toBeNull();
  });

  it("ceiling clamps large increase", () => {
    const input = makeInput({
      portfolioBalance: 1500000, // raw = 75k, prior = 50k, ceiling = 50k * 1.05 = 52.5k
      crossYearState: stateWith({ priorYearSpending: 50000 }),
    });
    const result = applyVanguardDynamic(
      { basePercent: 0.05, ceilingPercent: 0.05, floorPercent: 0.025 },
      input,
    );
    expect(result.projectedExpenses).toBeCloseTo(52500, 0);
    expect(result.action).toBe("ceiling_applied");
  });

  it("floor clamps large decrease", () => {
    const input = makeInput({
      portfolioBalance: 600000, // raw = 30k, prior = 50k, floor = 50k * 0.975 = 48.75k
      crossYearState: stateWith({ priorYearSpending: 50000 }),
    });
    const result = applyVanguardDynamic(
      { basePercent: 0.05, ceilingPercent: 0.05, floorPercent: 0.025 },
      input,
    );
    expect(result.projectedExpenses).toBeCloseTo(48750, 0);
    expect(result.action).toBe("floor_applied");
  });

  it("no clamping when within bounds", () => {
    const input = makeInput({
      portfolioBalance: 1020000, // raw = 51k, prior = 50k, within [48.75k, 52.5k]
      crossYearState: stateWith({ priorYearSpending: 50000 }),
    });
    const result = applyVanguardDynamic(
      { basePercent: 0.05, ceilingPercent: 0.05, floorPercent: 0.025 },
      input,
    );
    expect(result.projectedExpenses).toBeCloseTo(51000, 0);
    expect(result.action).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RMD-Based Spending
// ---------------------------------------------------------------------------

describe("rmd_spending", () => {
  it("pre-RMD age falls back to fixed spending", () => {
    const result = applyRmdSpending(
      { rmdMultiplier: 1.0 },
      makeInput({ age: 65 }),
    );
    expect(result.projectedExpenses).toBe(50000);
    expect(result.action).toBeNull();
  });

  it("age 73 uses IRS factor (26.5)", () => {
    const result = applyRmdSpending(
      { rmdMultiplier: 1.0 },
      makeInput({ age: 73 }),
    );
    // 1M / 26.5 = ~37735.85
    expect(result.projectedExpenses).toBeCloseTo(1000000 / 26.5, 0);
    expect(result.action).toBe("rmd_based");
  });

  it("multiplier scales the RMD amount", () => {
    const result = applyRmdSpending(
      { rmdMultiplier: 1.5 },
      makeInput({ age: 73 }),
    );
    expect(result.projectedExpenses).toBeCloseTo((1000000 / 26.5) * 1.5, 0);
  });

  it("age 90 uses factor 12.2", () => {
    const result = applyRmdSpending(
      { rmdMultiplier: 1.0 },
      makeInput({ age: 90, portfolioBalance: 500000 }),
    );
    expect(result.projectedExpenses).toBeCloseTo(500000 / 12.2, 0);
  });
});

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe("applySpendingStrategy dispatcher", () => {
  it("fixed strategy passes through expenses unchanged", () => {
    const result = applySpendingStrategy("fixed", {}, makeInput());
    expect(result.projectedExpenses).toBe(50000);
    expect(result.action).toBeNull();
  });

  it("dispatches to constant_percentage", () => {
    const result = applySpendingStrategy(
      "constant_percentage",
      { withdrawalPercent: 0.05, floorPercent: 0.9 },
      makeInput(),
    );
    expect(result.projectedExpenses).toBe(50000); // first year: 1M * 5%
    expect(result.updatedState.initialWithdrawalAmount).toBe(50000);
  });

  it("dispatches to guyton_klinger", () => {
    const result = applySpendingStrategy(
      "guyton_klinger",
      {
        upperGuardrail: 0.8,
        lowerGuardrail: 1.2,
        increasePercent: 0.1,
        decreasePercent: 0.1,
        skipInflationAfterLoss: true,
      },
      makeInput(),
    );
    // First year: captures initial rate, no guardrail action
    expect(result.projectedExpenses).toBe(50000);
    expect(result.action).toBeNull();
    expect(result.updatedState.initialWithdrawalRate).toBe(0.05);
  });
});
