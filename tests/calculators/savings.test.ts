import { describe, it, expect } from "vitest";
import { calculateSavings } from "@/lib/calculators/savings";
import type { SavingsInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

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
