import { describe, it, expect } from "vitest";
import {
  computeMaxMonthlyFunding,
  computeTotalMonthlyAllocation,
  resolveEffectiveMonthlyContribution,
  type CapacityPerson,
  type SavingsGoalForAllocation,
} from "@/lib/calculators/savings-capacity";

describe("computeMaxMonthlyFunding", () => {
  it("returns null when no active people", () => {
    const people: CapacityPerson[] = [{ paycheck: null, job: null }];
    expect(computeMaxMonthlyFunding(people, 5000)).toBeNull();
  });

  it("computes funding for a single person with biweekly pay", () => {
    const people: CapacityPerson[] = [
      {
        paycheck: { netPay: 3000, periodsPerYear: 26 },
        job: { id: 1 },
      },
    ];
    // Monthly net: 3000 * 26/12 = 6500
    // Max funding: 6500 - 5000 = 1500
    expect(computeMaxMonthlyFunding(people, 5000)).toBeCloseTo(1500, 0);
  });

  it("computes funding for multiple people", () => {
    const people: CapacityPerson[] = [
      {
        paycheck: { netPay: 3000, periodsPerYear: 26 },
        job: { id: 1 },
      },
      {
        paycheck: { netPay: 2000, periodsPerYear: 24 },
        job: { id: 2 },
      },
    ];
    // Person 1 monthly: 3000 * 26/12 = 6500
    // Person 2 monthly: 2000 * 24/12 = 4000
    // Total net: 10500
    // Max funding: 10500 - 8000 = 2500
    expect(computeMaxMonthlyFunding(people, 8000)).toBeCloseTo(2500, 0);
  });

  it("uses budgetPerMonth override when provided", () => {
    const people: CapacityPerson[] = [
      {
        paycheck: { netPay: 3000, periodsPerYear: 26 },
        job: { id: 1 },
        budgetPerMonth: 2.5, // override periods per month
      },
    ];
    // Monthly net: 3000 * 2.5 = 7500
    // Max funding: 7500 - 5000 = 2500
    expect(computeMaxMonthlyFunding(people, 5000)).toBeCloseTo(2500, 0);
  });

  it("skips inactive people (no paycheck)", () => {
    const people: CapacityPerson[] = [
      {
        paycheck: { netPay: 3000, periodsPerYear: 26 },
        job: { id: 1 },
      },
      { paycheck: null, job: null },
    ];
    // Only person 1 counts: 3000 * 26/12 = 6500
    expect(computeMaxMonthlyFunding(people, 5000)).toBeCloseTo(1500, 0);
  });

  it("returns negative when budget exceeds income", () => {
    const people: CapacityPerson[] = [
      {
        paycheck: { netPay: 2000, periodsPerYear: 24 },
        job: { id: 1 },
      },
    ];
    // Monthly net: 2000 * 24/12 = 4000
    // Max funding: 4000 - 5000 = -1000
    expect(computeMaxMonthlyFunding(people, 5000)).toBeCloseTo(-1000, 0);
  });
});

describe("computeTotalMonthlyAllocation", () => {
  it("returns 0 for empty list", () => {
    expect(computeTotalMonthlyAllocation([])).toBe(0);
  });

  it("sums contributions from active goals with positive contribution", () => {
    const goals: SavingsGoalForAllocation[] = [
      { isActive: true, monthlyContribution: 500 },
      { isActive: true, monthlyContribution: 300 },
    ];
    expect(computeTotalMonthlyAllocation(goals)).toBeCloseTo(800, 2);
  });

  it("ignores inactive goals", () => {
    const goals: SavingsGoalForAllocation[] = [
      { isActive: true, monthlyContribution: 500 },
      { isActive: false, monthlyContribution: 300 },
    ];
    expect(computeTotalMonthlyAllocation(goals)).toBeCloseTo(500, 2);
  });

  it("ignores goals with zero contribution", () => {
    const goals: SavingsGoalForAllocation[] = [
      { isActive: true, monthlyContribution: 500 },
      { isActive: true, monthlyContribution: 0 },
    ];
    expect(computeTotalMonthlyAllocation(goals)).toBeCloseTo(500, 2);
  });

  it("handles string contributions", () => {
    const goals: SavingsGoalForAllocation[] = [
      { isActive: true, monthlyContribution: "250.50" },
      { isActive: true, monthlyContribution: "100" },
    ];
    expect(computeTotalMonthlyAllocation(goals)).toBeCloseTo(350.5, 2);
  });
});

describe("resolveEffectiveMonthlyContribution", () => {
  it("computes percentage of the pool when allocationPercent is set", () => {
    // 37% of a $2229.98 pool — the Home Project drift case that motivated this.
    expect(resolveEffectiveMonthlyContribution(37, 2229.98, 825)).toBeCloseTo(
      825.0926,
      3,
    );
  });

  it("falls back to the flat amount when allocationPercent is null", () => {
    expect(resolveEffectiveMonthlyContribution(null, 2229.98, 825)).toBe(825);
  });

  it("falls back to the flat amount when maxMonthlyFunding is null", () => {
    expect(resolveEffectiveMonthlyContribution(37, null, 825)).toBe(825);
  });

  it("returns 0 for a 0% allocation regardless of pool size", () => {
    expect(resolveEffectiveMonthlyContribution(0, 5000, 825)).toBe(0);
  });
});
