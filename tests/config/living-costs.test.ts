import { describe, it, expect } from "vitest";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";

describe("living-costs", () => {
  it("all ranges have valid low/high percentages", () => {
    for (const range of RAMSEY_RANGES) {
      expect(range.name).toBeTruthy();
      expect(range.low).toBeGreaterThan(0);
      expect(range.high).toBeGreaterThan(range.low);
      expect(range.high).toBeLessThanOrEqual(1);
    }
  });

  it("the ranges can all be met at once (lows sum ≤ 100% ≤ highs sum)", () => {
    const lows = RAMSEY_RANGES.reduce((s, r) => s + r.low, 0);
    const highs = RAMSEY_RANGES.reduce((s, r) => s + r.high, 0);
    expect(lows).toBeLessThanOrEqual(1);
    expect(highs).toBeGreaterThanOrEqual(1);
  });

  it("the default mapping covers exactly the Ramsey ranges", () => {
    expect(Object.keys(DEFAULT_LIVING_COST_MAPPING).sort()).toEqual(
      RAMSEY_RANGES.map((r) => r.name).sort(),
    );
    for (const categories of Object.values(DEFAULT_LIVING_COST_MAPPING)) {
      expect(categories.length).toBeGreaterThan(0);
    }
  });
});
