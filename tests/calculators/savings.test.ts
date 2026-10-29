import { describe, it, expect } from "vitest";
import { calculateSavings } from "@/lib/calculators/savings";
import type { SavingsInput, SavingsGoalInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

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

describe("calculateSavings", () => {
  const input: SavingsInput = {
    goals: [
      {
        id: 1,
        name: "Emergency Fund",
        currentBalance: 15000,
        targetBalance: 25000,
        allocationPercent: 0.5,
        isEmergencyFund: true,
        isActive: true,
      },
      {
        id: 2,
        name: "Vacation",
        currentBalance: 2000,
        targetBalance: 5000,
        allocationPercent: 0.3,
        isEmergencyFund: false,
        isActive: true,
      },
      {
        id: 3,
        name: "New Car",
        currentBalance: 8000,
        targetBalance: 30000,
        allocationPercent: 0.2,
        isEmergencyFund: false,
        isActive: true,
      },
    ],
    monthlySavingsPool: 1500,
    essentialMonthlyExpenses: 5500,
    asOfDate: AS_OF_DATE,
  };

  it("computes overall progress", () => {
    const result = calculateSavings(input);
    // Total saved: 15000 + 2000 + 8000 = 25000
    expect(result.totalSaved).toBe(25000);
  });

  it("computes emergency fund months covered", () => {
    const result = calculateSavings(input);
    // $15,000 / $5,500 = 2.73 months
    expect(result.efundMonthsCovered).toBeCloseTo(2.73, 1);
  });

  it("computes monthly allocation per goal", () => {
    const result = calculateSavings(input);
    const efund = result.goals.find((g) => g.name === "Emergency Fund")!;
    // $1,500 × 50% = $750
    expect(efund.monthlyAllocation).toBe(750);
  });

  it("computes months to target", () => {
    const result = calculateSavings(input);
    const efund = result.goals.find((g) => g.name === "Emergency Fund")!;
    // Remaining: $25,000 - $15,000 = $10,000
    // At $750/month = ceil(13.33) = 14 months
    expect(efund.monthsToTarget).toBe(14);
  });

  it("returns 0 months when already at target", () => {
    const atTarget: SavingsInput = {
      ...input,
      goals: [
        { ...input.goals[0]!, currentBalance: 25000 }, // at target
        ...input.goals.slice(1),
      ],
    };
    const result = calculateSavings(atTarget);
    expect(result.goals[0]!.monthsToTarget).toBe(0);
  });

  it("validates allocation percentages sum to 100%", () => {
    const bad: SavingsInput = {
      ...input,
      goals: input.goals.map((g) => ({ ...g, allocationPercent: 0.1 })),
    };
    const result = calculateSavings(bad);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("30.0%");
  });

  it("no warning when allocations sum to 100%", () => {
    const result = calculateSavings(input);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns null efund months when no emergency fund goal exists", () => {
    const noEfund: SavingsInput = {
      ...input,
      goals: input.goals.map((g) => ({ ...g, isEmergencyFund: false })),
    };
    const result = calculateSavings(noEfund);
    expect(result.efundMonthsCovered).toBeNull();
  });

  it("excludes inactive goals", () => {
    const withInactive: SavingsInput = {
      ...input,
      goals: [
        ...input.goals,
        {
          id: 4,
          name: "Paused Goal",
          currentBalance: 1000,
          targetBalance: 10000,
          allocationPercent: 0,
          isEmergencyFund: false,
          isActive: false,
        },
      ],
    };
    const result = calculateSavings(withInactive);
    // Should only have 3 active goals
    expect(result.goals).toHaveLength(3);
  });

  it("returns null months-to-target when allocation is zero", () => {
    const zeroAlloc: SavingsInput = {
      ...input,
      goals: [{ ...input.goals[0]!, allocationPercent: 0 }],
    };
    const result = calculateSavings(zeroAlloc);
    expect(result.goals[0]!.monthsToTarget).toBeNull();
  });
});

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
