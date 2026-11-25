import { describe, expect, it } from "vitest";
import { placeWhole } from "@/lib/pure/accounts/place-whole";

describe("placeWhole", () => {
  it("rounds each member's amount; the largest share takes the cents left", () => {
    expect(placeWhole(100, [10, 30, 60])).toEqual([10, 30, 60]);
    // $10 at 1/7, 2/7, 4/7: 1.43 + 2.86 + 5.71 = 10.00; the 4/7 member takes no cent.
    expect(placeWhole(10, [10 / 7, 20 / 7, 40 / 7])).toEqual([
      1.43, 2.86, 5.71,
    ]);
    // $0.05 split 1:2:7 rounds to 0.01 + 0.01 + 0.04 = 0.06; the largest share gives back the 1¢ over.
    expect(placeWhole(0.05, [0.005, 0.01, 0.035])).toEqual([0.01, 0.01, 0.03]);
    // One member takes the whole amount, whatever its raw amount says.
    expect(placeWhole(10, [9.996])).toEqual([10]);
  });

  it("a tie goes to the earlier member: $100 in thirds is 33.34, 33.33, 33.33", () => {
    expect(placeWhole(100, [100 / 3, 100 / 3, 100 / 3])).toEqual([
      33.34, 33.33, 33.33,
    ]);
  });

  it("a $0 member never goes below $0 when rounded shares overshoot", () => {
    // $1,000.01 over [1, 1, 0]: 500.005 rounds up twice to 1,000.02; the
    // first $500 member gives back the cent, not the $0 member listed last.
    const placed = placeWhole(1000.01, [500.005, 500.005, 0]);
    expect(placed).toEqual([500, 500.01, 0]);
    expect(placed[2]).toBeGreaterThanOrEqual(0);
  });

  it("places the whole amount for any split", () => {
    for (const [amount, weights] of [
      [1234.57, [0.123, 0.456, 0.421]],
      [0.05, [0.5, 0.5, 0, 0]],
      [999_999.99, [1 / 7, 2 / 7, 4 / 7]],
    ] as const) {
      const placed = placeWhole(
        amount,
        weights.map((w) => amount * w),
      );
      const sum = placed.reduce((s, x) => s + x, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(amount * 100));
      placed.forEach((x) =>
        expect(Math.round(x * 100)).toBeCloseTo(x * 100, 6),
      );
    }
  });
});
