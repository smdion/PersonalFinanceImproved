/**
 * Tests for confidence-band derivation used by the retirement projection card.
 * Covers: deriveProjectionBand.
 */
import { describe, it, expect } from "vitest";
import { deriveProjectionBand } from "@/lib/pure/simulation/projection-bands";
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
