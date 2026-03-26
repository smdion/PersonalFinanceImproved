import { describe, it, expect } from "vitest";
import {
  RAMSEY_RANGES,
  DEFAULT_LIVING_COST_MAPPING,
} from "@/lib/config/living-costs";

describe("living-costs", () => {
  it("has 10 Ramsey ranges", () => {
    expect(RAMSEY_RANGES).toHaveLength(10);
  });

  it("all ranges have valid low/high percentages", () => {
    for (const range of RAMSEY_RANGES) {
      expect(range.name).toBeTruthy();
      expect(range.low).toBeGreaterThan(0);
      expect(range.high).toBeGreaterThan(range.low);
      expect(range.high).toBeLessThanOrEqual(1);
    }
  });

  it("default mapping covers all Ramsey range names", () => {
    const rangeNames = RAMSEY_RANGES.map((r) => r.name);
    for (const name of rangeNames) {
      expect(DEFAULT_LIVING_COST_MAPPING[name]).toBeDefined();
      expect(DEFAULT_LIVING_COST_MAPPING[name].length).toBeGreaterThan(0);
    }
  });

  it("all mapping values are non-empty string arrays", () => {
    for (const [key, categories] of Object.entries(
      DEFAULT_LIVING_COST_MAPPING,
    )) {
      expect(Array.isArray(categories), `${key} should be array`).toBe(true);
      for (const cat of categories) {
        expect(typeof cat).toBe("string");
        expect(cat.length).toBeGreaterThan(0);
      }
    }
  });
});
