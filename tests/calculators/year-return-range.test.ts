import { describe, it, expect } from "vitest";
import { yearReturnRanges } from "@/lib/calculators/year-return-range";

const assetClasses = [
  { id: 1, name: "Stocks", meanReturn: 0.1, stdDev: 0.18 },
  { id: 2, name: "Bonds", meanReturn: 0.04, stdDev: 0.06 },
];
const correlations = [{ classAId: 1, classBId: 2, correlation: 0.1 }];
const glidePath = [
  { age: 30, allocations: { 1: 1, 2: 0 } },
  { age: 70, allocations: { 1: 0, 2: 1 } },
];
const base = {
  assetClasses,
  correlations,
  glidePath,
  clampMin: -0.5,
  clampMax: 1,
};

describe("yearReturnRanges", () => {
  it("brackets the mean, and narrows as the mix moves to bonds", () => {
    const [young, old] = yearReturnRanges({ ...base, ages: [30, 70] });
    expect(young!.low).toBeLessThan(0.1);
    expect(young!.high).toBeGreaterThan(0.1);
    expect(old!.high - old!.low).toBeLessThan(young!.high - young!.low);
  });

  it("is the same every time for the same plan", () => {
    expect(yearReturnRanges({ ...base, ages: [40] })).toEqual(
      yearReturnRanges({ ...base, ages: [40] }),
    );
  });

  it("holds to the Simulation's limits", () => {
    const [r] = yearReturnRanges({
      ...base,
      ages: [30],
      clampMin: 0.05,
      clampMax: 0.06,
    });
    expect(r!.low).toBe(0.05);
    expect(r!.high).toBe(0.06);
  });

  it("nothing to sample: no ranges", () => {
    expect(yearReturnRanges({ ...base, ages: [30], glidePath: [] })).toEqual(
      [],
    );
  });
});
