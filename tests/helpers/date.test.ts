import { describe, it, expect } from "vitest";
import { isPriorYearContribWindow, ageInYear } from "@/lib/utils/date";
import { PENALTY_FREE_AGE } from "@/lib/constants";

describe("ageInYear", () => {
  it("computes integer age as year - birthYear", () => {
    expect(ageInYear(1990, 2026)).toBe(36);
  });

  it("the PENALTY_FREE_AGE (59.5) convention rounds eligibility up to 60, not down to 59", () => {
    // Born 1966: turns 59 in 2025, 60 in 2026. Year-granularity modeling has
    // no mid-year resolution, so a person born in 1966 is only considered
    // >= 59.5 starting the year they turn 60 (2026), not the year they turn
    // 59 (2025) even though they turn 59.5 partway through 2025.
    expect(ageInYear(1966, 2025) >= PENALTY_FREE_AGE).toBe(false);
    expect(ageInYear(1966, 2026) >= PENALTY_FREE_AGE).toBe(true);
  });
});

describe("isPriorYearContribWindow", () => {
  it("returns true for January 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 0, 1))).toBe(true);
  });

  it("returns true for February 15", () => {
    expect(isPriorYearContribWindow(new Date(2026, 1, 15))).toBe(true);
  });

  it("returns true for March 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 2, 31))).toBe(true);
  });

  it("returns true for April 15 (deadline day)", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 15))).toBe(true);
  });

  it("returns false for April 16", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 16))).toBe(false);
  });

  it("returns false for May 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 4, 1))).toBe(false);
  });

  it("returns false for December 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 11, 31))).toBe(false);
  });
});
