/**
 * Tests for pure MC projection blending logic.
 * Covers: blendedReturnForAge.
 */
import { describe, it, expect } from "vitest";
import { blendedReturnForAge } from "@/lib/pure/projection";

const equityClass = { id: 1, meanReturn: 0.1, stdDev: 0.18 };
const bondClass = { id: 2, meanReturn: 0.04, stdDev: 0.06 };
const assetClasses = [equityClass, bondClass];

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
