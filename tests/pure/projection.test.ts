/**
 * Tests for pure MC projection blending logic.
 * Covers: interpolateAllocations, blendedReturnForAge, blendDeterministicRates, blendedPortfolioStats.
 */
import { describe, it, expect } from "vitest";
import {
  interpolateAllocations,
  blendedReturnForAge,
  blendDeterministicRates,
  blendedPortfolioStats,
} from "@/lib/pure/projection";

const equityClass = { id: 1, meanReturn: 0.1, stdDev: 0.18 };
const bondClass = { id: 2, meanReturn: 0.04, stdDev: 0.06 };
const assetClasses = [equityClass, bondClass];

const glidePath = [
  { age: 30, allocations: { 1: 0.9, 2: 0.1 } },
  { age: 60, allocations: { 1: 0.6, 2: 0.4 } },
  { age: 80, allocations: { 1: 0.4, 2: 0.6 } },
];

describe("interpolateAllocations", () => {
  it("returns first entry at-or-above target age", () => {
    const allocs = interpolateAllocations(glidePath, 30);
    expect(allocs[1]).toBe(0.9);
    expect(allocs[2]).toBe(0.1);
  });

  it("returns next entry when between ages", () => {
    const allocs = interpolateAllocations(glidePath, 45);
    // Next entry at-or-above 45 is age 60
    expect(allocs[1]).toBe(0.6);
  });

  it("returns first entry when age is below range", () => {
    const allocs = interpolateAllocations(glidePath, 20);
    expect(allocs[1]).toBe(0.9);
  });

  it("returns empty object for empty glide path", () => {
    expect(interpolateAllocations([], 50)).toEqual({});
  });
});

describe("blendedReturnForAge", () => {
  it("computes weighted geometric mean return", () => {
    const allocs = { 1: 0.6, 2: 0.4 };
    const result = blendedReturnForAge(assetClasses, allocs);
    // Should be between equity and bond geometric means
    expect(result).toBeGreaterThan(0.03);
    expect(result).toBeLessThan(0.1);
  });

  it("returns 0 for zero allocations", () => {
    expect(blendedReturnForAge(assetClasses, { 1: 0, 2: 0 })).toBe(0);
  });

  it("returns pure equity rate at 100% equity", () => {
    const result = blendedReturnForAge(assetClasses, { 1: 1.0, 2: 0 });
    // Should equal geometricMean(0.10, 0.18)
    expect(result).toBeGreaterThan(0.06);
    expect(result).toBeLessThan(0.1);
  });
});

describe("blendDeterministicRates", () => {
  it("produces one entry per age", () => {
    const rates = blendDeterministicRates(assetClasses, glidePath, 30, 35);
    expect(rates).toHaveLength(6); // 30,31,32,33,34,35
    expect(rates[0]!.label).toBe("Age 30");
    expect(rates[5]!.label).toBe("Age 35");
  });

  it("rates decrease as equity allocation decreases with age", () => {
    const rates = blendDeterministicRates(assetClasses, glidePath, 30, 80);
    const first = rates[0]!.rate;
    const last = rates[rates.length - 1]!.rate;
    // Young = more equity = higher geometric return; old = more bonds = lower
    expect(first).toBeGreaterThan(last);
  });

  it("handles single-age range", () => {
    const rates = blendDeterministicRates(assetClasses, glidePath, 50, 50);
    expect(rates).toHaveLength(1);
  });
});

describe("blendedPortfolioStats", () => {
  it("returns both return and volatility", () => {
    const allocs = { 1: 0.7, 2: 0.3 };
    const stats = blendedPortfolioStats(assetClasses, allocs);
    expect(stats.blendedReturn).toBeGreaterThan(0);
    expect(stats.blendedVol).toBeGreaterThan(0);
    // Volatility = weighted sum of stdDevs
    expect(stats.blendedVol).toBeCloseTo(0.7 * 0.18 + 0.3 * 0.06);
  });
});
