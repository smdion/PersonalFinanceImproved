import { describe, it, expect } from "vitest";
import {
  getRegularPeriodsPerMonth,
  getBudgetFrequencyNote,
} from "@/lib/pure/paycheck/budget-periods";

describe("getRegularPeriodsPerMonth", () => {
  it("returns 2 for biweekly (26 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(26)).toBe(2);
  });

  it("returns 4 for weekly (52 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(52)).toBe(4);
  });

  it("returns 1 for monthly (12 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(12)).toBe(1);
  });

  it("respects budgetPeriodsOverride", () => {
    expect(getRegularPeriodsPerMonth(26, 3)).toBe(3);
  });

  it("ignores null override", () => {
    expect(getRegularPeriodsPerMonth(26, null)).toBe(2);
  });

  it("ignores zero override", () => {
    expect(getRegularPeriodsPerMonth(26, 0)).toBe(2);
  });

  it("falls back to periodsPerYear/12 for unknown period count", () => {
    expect(getRegularPeriodsPerMonth(36)).toBeCloseTo(3);
  });
});

describe("getBudgetFrequencyNote", () => {
  it("returns default note for biweekly", () => {
    expect(getBudgetFrequencyNote("biweekly")).toBe(
      "2 paychecks/month (3rd paycheck months excluded)",
    );
  });

  it("returns default note for weekly", () => {
    expect(getBudgetFrequencyNote("weekly")).toBe(
      "4 paychecks/month (5th paycheck months excluded)",
    );
  });

  it("returns default note for monthly", () => {
    expect(getBudgetFrequencyNote("monthly")).toBe("1 paycheck/month (exact)");
  });

  it("returns custom note when override differs from default", () => {
    // biweekly default is 2, override is 3
    expect(getBudgetFrequencyNote("biweekly", 3)).toBe(
      "3 paychecks/month (custom — default is 2)",
    );
  });

  it("returns default note when override equals default", () => {
    // biweekly default is 2, override is also 2 → shows default note
    expect(getBudgetFrequencyNote("biweekly", 2)).toBe(
      "2 paychecks/month (3rd paycheck months excluded)",
    );
  });

  it("ignores null override", () => {
    expect(getBudgetFrequencyNote("biweekly", null)).toBe(
      "2 paychecks/month (3rd paycheck months excluded)",
    );
  });

  it("ignores zero override", () => {
    expect(getBudgetFrequencyNote("biweekly", 0)).toBe(
      "2 paychecks/month (3rd paycheck months excluded)",
    );
  });

  it("returns empty string for unknown pay period", () => {
    expect(getBudgetFrequencyNote("daily")).toBe("");
  });
});
