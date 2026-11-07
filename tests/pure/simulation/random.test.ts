/**
 * Tests for the two weighted blends in random.ts: the fixed-return line's
 * rate (Σ w·G) and the shown volatility (Σ w·σ, correlation-free, SIM-18).
 * Covers: weightedGeometricRate, classWeightedVolatility.
 */
import { describe, it, expect } from "vitest";
import {
  classWeightedVolatility,
  geometricMean,
  weightedGeometricRate,
} from "@/lib/pure/simulation/random";

const equityClass = { id: 1, meanReturn: 0.1, stdDev: 0.18 };
const bondClass = { id: 2, meanReturn: 0.04, stdDev: 0.06 };
const assetClasses = [equityClass, bondClass];

describe("weightedGeometricRate", () => {
  it("computes weighted geometric mean return", () => {
    const allocs = { 1: 0.6, 2: 0.4 };
    const result = weightedGeometricRate(assetClasses, allocs);
    expect(result).toBeCloseTo(
      0.6 * geometricMean(0.1, 0.18) + 0.4 * geometricMean(0.04, 0.06),
      12,
    );
  });

  it("returns 0 for zero allocations", () => {
    expect(weightedGeometricRate(assetClasses, { 1: 0, 2: 0 })).toBe(0);
  });

  it("returns pure equity rate at 100% equity", () => {
    const result = weightedGeometricRate(assetClasses, { 1: 1.0, 2: 0 });
    expect(result).toBe(geometricMean(0.1, 0.18));
  });

  it("leaves out a class at or below 0%", () => {
    expect(weightedGeometricRate(assetClasses, { 1: 1, 2: -0.5 })).toBe(
      geometricMean(0.1, 0.18),
    );
  });
});

describe("classWeightedVolatility", () => {
  it("weights each class's deviation by its share, without correlation", () => {
    expect(
      classWeightedVolatility(assetClasses, { 1: 0.6, 2: 0.4 }),
    ).toBeCloseTo(0.6 * 0.18 + 0.4 * 0.06, 12);
  });

  it("counts a missing class as 0%", () => {
    expect(classWeightedVolatility(assetClasses, { 1: 0.5 })).toBeCloseTo(
      0.09,
      12,
    );
  });
});
