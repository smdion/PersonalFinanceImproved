import { describe, it, expect } from "vitest";
import {
  computeMaxMonthlyFunding,
  type CapacityPerson,
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
