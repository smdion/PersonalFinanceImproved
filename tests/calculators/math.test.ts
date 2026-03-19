import { describe, it, expect } from "vitest";
import { safeDivide, roundToCents, sumBy } from "@/lib/utils/math";

describe("safeDivide", () => {
  it("divides normally when denominator is non-zero", () => {
    expect(safeDivide(10, 3)).toBeCloseTo(3.3333, 4);
  });

  it("returns 0 when denominator is zero and no fallback", () => {
    expect(safeDivide(10, 0)).toBe(0);
  });

  it("returns null when denominator is zero and fallback is null", () => {
    expect(safeDivide(10, 0, null)).toBeNull();
  });

  it("returns fallback number when denominator is zero", () => {
    expect(safeDivide(10, 0, -1)).toBe(-1);
  });
});

describe("roundToCents", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToCents(2879.105)).toBe(2879.11);
    expect(roundToCents(2879.104)).toBe(2879.1);
  });
});

describe("sumBy", () => {
  it("sums array by accessor function", () => {
    const items = [{ amount: 10 }, { amount: 20 }, { amount: 30 }];
    expect(sumBy(items, (i) => i.amount)).toBe(60);
  });

  it("returns 0 for empty array", () => {
    expect(sumBy([], () => 1)).toBe(0);
  });
});
