import { describe, it, expect } from "vitest";
import {
  limitAge,
  ageOnDate,
  countReachingAgeRule,
  reachesAgeRule,
} from "@/lib/pure/household/age";

describe("reachesAgeRule (age at Dec 31)", () => {
  it("QCD from the year the person turns 70", () => {
    expect(reachesAgeRule(1957, "qcd", 2026)).toBe(false);
    expect(reachesAgeRule(1956, "qcd", 2026)).toBe(true);
  });

  it("Medicare from the year the person turns 65", () => {
    expect(reachesAgeRule(1962, "medicare", 2026)).toBe(false);
    expect(reachesAgeRule(1961, "medicare", 2026)).toBe(true);
  });
});

describe("countReachingAgeRule", () => {
  it("counts each person from their birth year", () => {
    expect(countReachingAgeRule([1958, 1963], 68, "medicare", 2026)).toBe(1);
    expect(countReachingAgeRule([1958, 1960], 0, "medicare", 2026)).toBe(2);
  });

  it("without birth years, the representative age stands for one person", () => {
    expect(countReachingAgeRule(undefined, 65, "medicare", 2026)).toBe(1);
    expect(countReachingAgeRule([], 64, "medicare", 2026)).toBe(0);
  });
});

describe("limitAge", () => {
  it("is the year minus the stored birth year", () => {
    expect(limitAge("1980-12-31", 2026)).toBe(46);
    expect(limitAge("1980-01-01", 2026)).toBe(46);
  });
});

describe("ageOnDate", () => {
  it("counts the birthday once it has passed", () => {
    expect(ageOnDate("1980-06-15", new Date(2026, 5, 20))).toBe(46);
    expect(ageOnDate("1980-06-15", new Date(2026, 5, 10))).toBe(45);
  });

  it("reads the stored date as a local calendar day in any time zone", () => {
    // Born 1960-01-01: 66 on Dec 31 2026, 67 on Jan 1 2027 (`pnpm test:tz`
    // runs this west of UTC, where a UTC-midnight parse read 67 a day early).
    expect(ageOnDate("1960-01-01", new Date(2026, 11, 31))).toBe(66);
    expect(ageOnDate("1960-01-01", new Date(2027, 0, 1))).toBe(67);
  });
});
