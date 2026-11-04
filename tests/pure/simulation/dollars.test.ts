/**
 * flatDeflator and toTodaysDollars: a view's flat-rate today's dollars.
 */
import { describe, it, expect } from "vitest";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";

describe("toTodaysDollars with a flat deflator", () => {
  const deflator = flatDeflator(2026, 0.03);

  it("divides by (1 + rate)^years after the base year", () => {
    // $10,000 in 2036 at 3%: 10,000 / 1.03^10 = 7,440.94 (hand-worked).
    expect(toTodaysDollars(10_000, 2036, deflator)).toBeCloseTo(7_440.94, 2);
    expect(toTodaysDollars(103, 2027, deflator)).toBeCloseTo(100, 10);
  });

  it("leaves the base year and earlier years as they are", () => {
    expect(toTodaysDollars(5_000, 2026, deflator)).toBe(5_000);
    expect(toTodaysDollars(5_000, 2020, deflator)).toBe(5_000);
    expect(deflator.indexOf(2026)).toBe(1);
    expect(deflator.baseYear).toBe(2026);
  });

  it("is the identity at a zero rate", () => {
    expect(toTodaysDollars(1_234.56, 2060, flatDeflator(2026, 0))).toBe(
      1_234.56,
    );
  });

  it("gives the same figure as the formula the views used before", () => {
    const old = (value: number, year: number) =>
      year - 2026 > 0 ? value / Math.pow(1 + 0.031, year - 2026) : value;
    const d = flatDeflator(2026, 0.031);
    for (const [value, year] of [
      [987_654.32, 2051],
      [-4_200, 2030],
      [0, 2090],
      [55.5, 2026],
    ] as const) {
      expect(toTodaysDollars(value, year, d)).toBe(old(value, year));
    }
  });
});
