import { describe, it, expect } from "vitest";
import { planExpectedNow, yearFraction } from "@/lib/pure/retirement/plan-pace";

describe("planExpectedNow", () => {
  const base = {
    yearStartBalance: 100_000,
    annualRate: 0.1,
    yearContributions: 12_000,
  };

  it("at the start of the year it's the finalized balance", () => {
    expect(planExpectedNow({ ...base, fraction: 0 })).toBe(100_000);
  });

  it("a full year: a year's growth, contributions growing half of it", () => {
    expect(planExpectedNow({ ...base, fraction: 1 })).toBeCloseTo(
      110_000 + 12_000 * Math.sqrt(1.1),
    );
  });

  it("part way: compounding for that share, that share of contributions", () => {
    expect(planExpectedNow({ ...base, fraction: 0.5 })).toBeCloseTo(
      100_000 * Math.sqrt(1.1) + 6_000 * Math.pow(1.1, 0.25),
    );
  });
});

describe("yearFraction", () => {
  it("counts the day itself, and stays within the year", () => {
    expect(yearFraction("2026-12-31", 2026)).toBe(1);
    expect(yearFraction("2026-01-01", 2026)).toBeCloseTo(1 / 365);
    expect(yearFraction("2026-10-30", 2026)).toBeCloseTo(303 / 365);
    expect(yearFraction("2027-01-02", 2026)).toBe(1);
  });
});
