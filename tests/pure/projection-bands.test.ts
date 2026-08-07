/**
 * Tests for confidence-band derivation used by the retirement projection card.
 * Covers: deriveProjectionBand, bandFractionForPortfolio.
 */
import { describe, it, expect } from "vitest";
import {
  deriveProjectionBand,
  bandFractionForPortfolio,
} from "@/lib/pure/projection-bands";
import { compactCurrency } from "@/lib/utils/format";

describe("deriveProjectionBand", () => {
  it("derives a symmetric +/-25% band by default", () => {
    const band = deriveProjectionBand(1_000_000);
    expect(band.point).toBe(1_000_000);
    expect(band.rangeFraction).toBe(0.25);
    expect(band.low).toBe(750_000);
    expect(band.high).toBe(1_250_000);
  });

  it("uses a custom range fraction when provided", () => {
    const band = deriveProjectionBand(1_000_000, 0.4);
    expect(band.rangeFraction).toBe(0.4);
    expect(band.low).toBe(600_000);
    expect(band.high).toBe(1_400_000);
  });

  it("clamps the low bound at 0 when the fraction would go negative", () => {
    // point=100, fraction=1.5 -> naive low = -50, should clamp to 0
    const band = deriveProjectionBand(100, 1.5);
    expect(band.low).toBe(0);
    expect(band.high).toBe(250);
  });

  it("returns a zeroed band with 'Insufficient data' label for negative point", () => {
    const band = deriveProjectionBand(-500);
    expect(band).toEqual({
      point: 0,
      low: 0,
      high: 0,
      rangeFraction: 0,
      label: "Insufficient data",
    });
  });

  it("returns a zeroed band for NaN point", () => {
    const band = deriveProjectionBand(NaN);
    expect(band.label).toBe("Insufficient data");
    expect(band.point).toBe(0);
  });

  it("returns a zeroed band for Infinity", () => {
    const band = deriveProjectionBand(Infinity);
    expect(band.label).toBe("Insufficient data");
  });

  it("handles a point of exactly 0", () => {
    const band = deriveProjectionBand(0);
    expect(band.point).toBe(0);
    expect(band.low).toBe(0);
    expect(band.high).toBe(0);
    expect(band.rangeFraction).toBe(0.25);
    expect(band.label).not.toBe("Insufficient data");
  });

  it("builds a human-readable label using compactCurrency for point/low/high", () => {
    const band = deriveProjectionBand(2_400_000);
    const expectedLabel = `Most likely ${compactCurrency(2_400_000)} (range ${compactCurrency(1_800_000)}–${compactCurrency(3_000_000)})`;
    expect(band.label).toBe(expectedLabel);
  });

  it("a zero range fraction collapses low/high to the point estimate", () => {
    const band = deriveProjectionBand(500_000, 0);
    expect(band.low).toBe(500_000);
    expect(band.high).toBe(500_000);
  });
});

describe("bandFractionForPortfolio", () => {
  it("returns the base 0.2 fraction for a short horizon, mid-range equity", () => {
    const fraction = bandFractionForPortfolio(10, 60);
    expect(fraction).toBe(0.2);
  });

  it("widens by 0.1 for horizons > 20 years", () => {
    const fraction = bandFractionForPortfolio(21, 60);
    expect(fraction).toBeCloseTo(0.3, 5);
  });

  it("does not widen for horizon exactly 20 years (boundary, exclusive)", () => {
    const fraction = bandFractionForPortfolio(20, 60);
    expect(fraction).toBe(0.2);
  });

  it("widens by 0.05 for equity allocation > 80%", () => {
    const fraction = bandFractionForPortfolio(10, 81);
    expect(fraction).toBeCloseTo(0.25, 5);
  });

  it("does not widen for equity exactly 80% (boundary, exclusive)", () => {
    const fraction = bandFractionForPortfolio(10, 80);
    expect(fraction).toBe(0.2);
  });

  it("narrows by 0.05 for equity allocation < 40%", () => {
    const fraction = bandFractionForPortfolio(10, 39);
    expect(fraction).toBeCloseTo(0.15, 5);
  });

  it("does not narrow for equity exactly 40% (boundary, exclusive)", () => {
    const fraction = bandFractionForPortfolio(10, 40);
    expect(fraction).toBe(0.2);
  });

  it("combines long horizon + heavy equity for a wider band", () => {
    const fraction = bandFractionForPortfolio(30, 90);
    expect(fraction).toBeCloseTo(0.35, 5);
  });

  it("combines long horizon + bond-heavy allocation", () => {
    const fraction = bandFractionForPortfolio(30, 20);
    // 0.2 + 0.1 (long horizon) - 0.05 (bond-heavy) = 0.25
    expect(fraction).toBeCloseTo(0.25, 5);
  });

  it("extreme long-horizon + heavy-equity inputs stay within the clamp bounds", () => {
    // Max achievable via the modifiers is 0.2 + 0.1 + 0.05 = 0.35, well under
    // the 0.5 clamp ceiling — the clamp never actually engages given the
    // current modifier magnitudes, but the result must still be <= 0.5.
    const fraction = bandFractionForPortfolio(100, 100);
    expect(fraction).toBeLessThanOrEqual(0.5);
    expect(fraction).toBeCloseTo(0.35, 5);
  });

  it("extreme short-horizon + bond-heavy inputs stay within the clamp bounds", () => {
    // Min achievable via the modifiers is 0.2 - 0.05 = 0.15, well above the
    // 0.1 clamp floor — the clamp never actually engages given the current
    // modifier magnitudes, but the result must still be >= 0.1.
    const fraction = bandFractionForPortfolio(0, 0);
    expect(fraction).toBeGreaterThanOrEqual(0.1);
    expect(fraction).toBeCloseTo(0.15, 5);
  });
});
