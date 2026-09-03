/**
 * gainLossTextColor / overUnderTextColor — the two polarities of the
 * red/green a signed value cell uses. Callers must still pair the color with
 * a non-color cue (sign, glyph, or trailing word) per WCAG 1.4.1; this test
 * only pins the color mapping and its two opposite polarities.
 */
import { describe, it, expect } from "vitest";
import { gainLossTextColor, overUnderTextColor } from "@/lib/utils/colors";

describe("gainLossTextColor — positive is good (green)", () => {
  it("positive → green, negative → red, zero → neutral", () => {
    expect(gainLossTextColor(1200)).toBe("text-green-600");
    expect(gainLossTextColor(-1200)).toBe("text-red-600");
    expect(gainLossTextColor(0)).toBe("text-muted");
  });
});

describe("overUnderTextColor — over budget is bad (red), opposite polarity", () => {
  it("positive → red, negative → green, zero → neutral", () => {
    expect(overUnderTextColor(50)).toBe("text-red-600");
    expect(overUnderTextColor(-50)).toBe("text-green-600");
    expect(overUnderTextColor(0)).toBe("text-muted");
  });

  it("is the inverse of gainLossTextColor for non-zero values", () => {
    for (const n of [-999, -1, 1, 42, 100000]) {
      expect(overUnderTextColor(n)).not.toBe(gainLossTextColor(n));
    }
  });
});
