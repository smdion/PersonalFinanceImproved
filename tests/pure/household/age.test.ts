import { describe, it, expect } from "vitest";
import { countReachingAgeRule, reachesAgeRule } from "@/lib/pure/household/age";

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
