/**
 * Edge case tests for math utilities.
 * roundToCents is used in 59+ files — its correctness is load-bearing.
 */
import { describe, it, expect } from "vitest";
import { roundToCents, safeDivide, sumBy } from "@/lib/utils/math";

describe("roundToCents", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToCents(1.234)).toBe(1.23);
    expect(roundToCents(1.235)).toBe(1.24); // half-up
    expect(roundToCents(1.999)).toBe(2.0);
  });

  it("handles exact cents (no-op)", () => {
    expect(roundToCents(1.0)).toBe(1.0);
    expect(roundToCents(0.01)).toBe(0.01);
    expect(roundToCents(100.99)).toBe(100.99);
  });

  it("handles zero", () => {
    expect(roundToCents(0)).toBe(0);
    // -0 stays -0 in IEEE 754; Object.is distinguishes, but toBe uses ===
    expect(roundToCents(-0)).toBe(-0);
  });

  it("handles negative values", () => {
    expect(roundToCents(-1.234)).toBe(-1.23);
    // Math.round(-1.235 * 100) = -124 due to float representation
    expect(roundToCents(-1.235)).toBe(-1.24);
    // Math.round(-0.005 * 100) = 0 (rounds toward +∞ at 0.5 boundary)
    expect(roundToCents(-0.005)).toBe(-0);
  });

  it("handles very small values near zero", () => {
    expect(roundToCents(0.001)).toBe(0);
    expect(roundToCents(0.004)).toBe(0);
    expect(roundToCents(0.005)).toBe(0.01);
    expect(roundToCents(0.009)).toBe(0.01);
  });

  it("handles large values", () => {
    expect(roundToCents(999999999.99)).toBe(999999999.99);
    expect(roundToCents(1234567.891)).toBe(1234567.89);
  });

  it("handles the classic 0.1 + 0.2 float issue", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754
    expect(roundToCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe("safeDivide", () => {
  it("divides normally when denominator is non-zero", () => {
    expect(safeDivide(10, 2)).toBe(5);
    expect(safeDivide(1, 3)).toBeCloseTo(0.333, 2);
  });

  it("returns 0 by default when dividing by zero", () => {
    expect(safeDivide(10, 0)).toBe(0);
  });

  it("returns custom fallback when dividing by zero", () => {
    expect(safeDivide(10, 0, 42)).toBe(42);
  });

  it("returns null when fallback is null", () => {
    expect(safeDivide(10, 0, null)).toBeNull();
  });
});

describe("sumBy", () => {
  it("sums numeric property", () => {
    const items = [{ v: 1 }, { v: 2 }, { v: 3 }];
    expect(sumBy(items, (i) => i.v)).toBe(6);
  });

  it("returns 0 for empty array", () => {
    expect(sumBy([], () => 1)).toBe(0);
  });
});
