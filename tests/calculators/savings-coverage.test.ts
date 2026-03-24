/**
 * Savings calculator tests for branch coverage.
 *
 * Covers:
 *   - All goals inactive (empty activeGoals)
 *   - Allocation not summing to 100% (warning)
 *   - Allocation exactly 100% (no warning)
 *   - Emergency fund with zero essential expenses (safeDivide returns null → 0)
 *   - No emergency fund goal flagged
 *   - Goal already at target (monthsToTarget = 0)
 *   - Goal with $0 allocation (monthsToTarget = null)
 *   - Multiple active goals with correct per-goal breakdown
 *   - Mix of active and inactive goals
 *   - Progress calculation (current/target)
 *   - Zero savings pool
 */
import { describe, it, expect } from "vitest";
import { calculateSavings } from "@/lib/calculators/savings";
import type { SavingsInput, SavingsGoalInput } from "@/lib/calculators/types";

const AS_OF_DATE = new Date("2025-03-07");

function makeGoal(overrides: Partial<SavingsGoalInput> = {}): SavingsGoalInput {
  return {
    id: 1,
    name: "Test Goal",
    currentBalance: 5000,
    targetBalance: 10000,
    allocationPercent: 1.0, // 100%
    isEmergencyFund: false,
    isActive: true,
    ...overrides,
  };
}

describe("calculateSavings — branch coverage", () => {
  it("returns empty results when all goals are inactive", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ isActive: false })],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals).toHaveLength(0);
    expect(result.totalSaved).toBe(0);
    expect(result.efundMonthsCovered).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it("returns empty results when goals array is empty", () => {
    const input: SavingsInput = {
      goals: [],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals).toHaveLength(0);
    expect(result.totalSaved).toBe(0);
    expect(result.efundMonthsCovered).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when allocations do not sum to 100%", () => {
    const input: SavingsInput = {
      goals: [
        makeGoal({ id: 1, allocationPercent: 0.5 }),
        makeGoal({ id: 2, allocationPercent: 0.3 }),
      ],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.warnings).toContainEqual(expect.stringContaining("80.0%"));
  });

  it("does not warn when allocations sum to exactly 100%", () => {
    const input: SavingsInput = {
      goals: [
        makeGoal({ id: 1, allocationPercent: 0.6 }),
        makeGoal({ id: 2, allocationPercent: 0.4 }),
      ],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn when allocations are within tolerance (0.995)", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ allocationPercent: 0.995 })],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.warnings).toHaveLength(0);
  });

  it("computes efundMonthsCovered for emergency fund goal", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ isEmergencyFund: true, currentBalance: 12000 })],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 4000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // 12000 / 4000 = 3.0
    expect(result.efundMonthsCovered).toBe(3);
  });

  it("returns efundMonthsCovered = 0 when essential expenses are 0", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ isEmergencyFund: true, currentBalance: 10000 })],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 0,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // safeDivide(10000, 0) returns null → Number(null ?? 0) = 0
    expect(result.efundMonthsCovered).toBe(0);
  });

  it("returns null efundMonthsCovered when no goal is flagged as emergency fund", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ isEmergencyFund: false })],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 4000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.efundMonthsCovered).toBeNull();
  });

  it("returns monthsToTarget = 0 when goal is at or above target", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ currentBalance: 15000, targetBalance: 10000 })],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals[0]!.monthsToTarget).toBe(0);
  });

  it("returns monthsToTarget = null when allocation is $0", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ allocationPercent: 0 })],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals[0]!.monthsToTarget).toBeNull();
  });

  it("returns monthsToTarget = null when savings pool is $0", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ currentBalance: 5000, targetBalance: 10000 })],
      monthlySavingsPool: 0,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals[0]!.monthsToTarget).toBeNull();
  });

  it("computes correct monthsToTarget", () => {
    const input: SavingsInput = {
      goals: [
        makeGoal({
          currentBalance: 5000,
          targetBalance: 10000,
          allocationPercent: 1.0,
        }),
      ],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // remaining = 5000, monthly allocation = 1000 * 1.0 = 1000
    // months = ceil(5000 / 1000) = 5
    expect(result.goals[0]!.monthsToTarget).toBe(5);
  });

  it("computes progress as currentBalance / targetBalance", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ currentBalance: 3000, targetBalance: 10000 })],
      monthlySavingsPool: 500,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // 3000 / 10000 = 0.3
    expect(result.goals[0]!.progress).toBeCloseTo(0.3, 4);
  });

  it("handles multiple active goals correctly", () => {
    const input: SavingsInput = {
      goals: [
        makeGoal({
          id: 1,
          name: "E-Fund",
          currentBalance: 6000,
          targetBalance: 12000,
          allocationPercent: 0.5,
          isEmergencyFund: true,
        }),
        makeGoal({
          id: 2,
          name: "Vacation",
          currentBalance: 1000,
          targetBalance: 5000,
          allocationPercent: 0.3,
        }),
        makeGoal({
          id: 3,
          name: "Car",
          currentBalance: 2000,
          targetBalance: 20000,
          allocationPercent: 0.2,
        }),
      ],
      monthlySavingsPool: 2000,
      essentialMonthlyExpenses: 4000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals).toHaveLength(3);
    expect(result.totalSaved).toBe(9000); // 6000 + 1000 + 2000

    // E-Fund: 2000 * 0.5 = $1000/mo, remaining = 6000, ceil(6000/1000) = 6
    const efund = result.goals.find((g) => g.name === "E-Fund")!;
    expect(efund.monthlyAllocation).toBe(1000);
    expect(efund.monthsToTarget).toBe(6);

    // Vacation: 2000 * 0.3 = $600/mo, remaining = 4000, ceil(4000/600) = 7
    const vacation = result.goals.find((g) => g.name === "Vacation")!;
    expect(vacation.monthlyAllocation).toBe(600);
    expect(vacation.monthsToTarget).toBe(7);

    // Car: 2000 * 0.2 = $400/mo, remaining = 18000, ceil(18000/400) = 45
    const car = result.goals.find((g) => g.name === "Car")!;
    expect(car.monthlyAllocation).toBe(400);
    expect(car.monthsToTarget).toBe(45);

    // efundMonthsCovered = 6000 / 4000 = 1.5
    expect(result.efundMonthsCovered).toBe(1.5);
  });

  it("excludes inactive goals from calculations", () => {
    const input: SavingsInput = {
      goals: [
        makeGoal({
          id: 1,
          name: "Active",
          currentBalance: 5000,
          isActive: true,
          allocationPercent: 1.0,
        }),
        makeGoal({
          id: 2,
          name: "Paused",
          currentBalance: 3000,
          isActive: false,
          allocationPercent: 0.5,
        }),
      ],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.name).toBe("Active");
    // Only active goal counted in totalSaved
    expect(result.totalSaved).toBe(5000);
  });

  it("computes monthlyAllocation correctly with fractional percentages", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ allocationPercent: 0.333 })],
      monthlySavingsPool: 3000,
      essentialMonthlyExpenses: 2000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // 3000 * 0.333 = 999, rounded to cents
    expect(result.goals[0]!.monthlyAllocation).toBeCloseTo(999, 0);
  });

  it("progress is 0 when target is 0 (safeDivide fallback)", () => {
    const input: SavingsInput = {
      goals: [makeGoal({ currentBalance: 5000, targetBalance: 0 })],
      monthlySavingsPool: 1000,
      essentialMonthlyExpenses: 3000,
      asOfDate: AS_OF_DATE,
    };

    const result = calculateSavings(input);
    // safeDivide(5000, 0) returns null → Number(null ?? 0) = 0
    expect(result.goals[0]!.progress).toBe(0);
    // remaining = max(0, 0 - 5000) = 0, so monthsToTarget = 0
    expect(result.goals[0]!.monthsToTarget).toBe(0);
  });
});
