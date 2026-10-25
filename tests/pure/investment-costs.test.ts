/** Account fees per year, and a year of both kinds of cost. */
import { describe, it, expect } from "vitest";
import { accountFeesForYears, allInYearlyCost } from "@/lib/pure/performance";

describe("accountFeesForYears", () => {
  it("sums this year and last; null for a year with no rows", () => {
    const rows = [
      { year: 2030, fees: "100.00" },
      { year: 2030, fees: "8.50" },
      { year: 2031, fees: "12.75" },
      { year: 2031, fees: null },
      { year: 2029, fees: "999" },
    ];
    expect(accountFeesForYears(rows, 2031)).toEqual({
      year: 2031,
      thisYear: 12.75,
      lastYear: 108.5,
    });
    expect(accountFeesForYears(rows, 2033)).toEqual({
      year: 2033,
      thisYear: null,
      lastYear: null,
    });
  });
});

describe("allInYearlyCost", () => {
  it("fund costs plus last full year's account fees (this year's when no full year)", () => {
    expect(allInYearlyCost(545, { thisYear: 134, lastYear: 168 })).toBe(713);
    expect(allInYearlyCost(545, { thisYear: 134, lastYear: null })).toBe(679);
    expect(allInYearlyCost(null, { thisYear: null, lastYear: 168 })).toBe(168);
    expect(
      allInYearlyCost(null, { thisYear: null, lastYear: null }),
    ).toBeNull();
  });
});
