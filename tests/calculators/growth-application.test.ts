import { describe, it, expect } from "vitest";
import { resolveReturnRateForAge } from "@/lib/calculators/engine/growth-application";
import { MIN_RETURN_RATE } from "@/lib/constants";

describe("resolveReturnRateForAge (R47 — extracted from pre-year-setup.ts)", () => {
  it("returns the exact rate for an age with a configured entry", () => {
    const map = new Map([
      [30, 0.08],
      [50, 0.06],
    ]);
    expect(resolveReturnRateForAge(map, 30)).toBe(0.08);
    expect(resolveReturnRateForAge(map, 50)).toBe(0.06);
  });

  it("falls back to the closest configured age at or below the requested age", () => {
    const map = new Map([
      [30, 0.08],
      [50, 0.06],
    ]);
    // 42 has no entry -- falls back to 30's rate (the closest age <= 42).
    expect(resolveReturnRateForAge(map, 42)).toBe(0.08);
    // 65 has no entry -- falls back to 50's rate.
    expect(resolveReturnRateForAge(map, 65)).toBe(0.06);
  });

  it("throws when no configured age is at or below the requested age", () => {
    const map = new Map([[50, 0.06]]);
    expect(() => resolveReturnRateForAge(map, 30)).toThrow(
      /No return rate configured/,
    );
  });

  it("floors at MIN_RETURN_RATE", () => {
    const map = new Map([[30, MIN_RETURN_RATE - 1]]);
    expect(resolveReturnRateForAge(map, 30)).toBe(MIN_RETURN_RATE);
  });

  it("does not floor a rate already above MIN_RETURN_RATE", () => {
    const map = new Map([[30, 0.1]]);
    expect(resolveReturnRateForAge(map, 30)).toBe(0.1);
  });
});
