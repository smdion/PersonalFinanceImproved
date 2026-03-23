import { describe, it, expect } from "vitest";
import {
  toNumber,
  getPrimaryPerson,
  getPeriodsPerYear,
  getRegularPeriodsPerMonth,
  breakdownByTaxType,
} from "@/server/helpers/transforms";

describe("toNumber", () => {
  it("parses numeric string", () => {
    expect(toNumber("123.45")).toBe(123.45);
  });

  it("returns 0 for null", () => {
    expect(toNumber(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(toNumber(undefined)).toBe(0);
  });

  it("returns NaN for non-numeric string", () => {
    expect(toNumber("abc")).toBeNaN();
  });

  it("parses empty string as NaN", () => {
    expect(toNumber("")).toBeNaN();
  });

  it("parses negative numbers", () => {
    expect(toNumber("-42.5")).toBe(-42.5);
  });

  it("parses zero", () => {
    expect(toNumber("0")).toBe(0);
  });
});

describe("getPrimaryPerson", () => {
  it("returns the person with isPrimaryUser=true", () => {
    const people = [
      { isPrimaryUser: false, name: "Partner" },
      { isPrimaryUser: true, name: "Primary" },
    ];
    expect(getPrimaryPerson(people)?.name).toBe("Primary");
  });

  it("falls back to first person when no primary flag", () => {
    const people = [
      { isPrimaryUser: false, name: "First" },
      { isPrimaryUser: false, name: "Second" },
    ];
    expect(getPrimaryPerson(people)?.name).toBe("First");
  });

  it("returns null for empty array", () => {
    expect(getPrimaryPerson([])).toBeNull();
  });
});

describe("getPeriodsPerYear", () => {
  it("returns 52 for weekly", () => {
    expect(getPeriodsPerYear("weekly")).toBe(52);
  });

  it("returns 26 for biweekly", () => {
    expect(getPeriodsPerYear("biweekly")).toBe(26);
  });

  it("returns 24 for semimonthly", () => {
    expect(getPeriodsPerYear("semimonthly")).toBe(24);
  });

  it("returns 12 for monthly", () => {
    expect(getPeriodsPerYear("monthly")).toBe(12);
  });

  it("throws for unknown pay period", () => {
    expect(() => getPeriodsPerYear("daily")).toThrow(
      /Unknown pay period "daily"/,
    );
  });
});

describe("getRegularPeriodsPerMonth", () => {
  it("returns 2 for biweekly (26 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(26)).toBe(2);
  });

  it("returns 4 for weekly (52 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(52)).toBe(4);
  });

  it("returns 1 for monthly (12 periods/year)", () => {
    expect(getRegularPeriodsPerMonth(12)).toBe(1);
  });

  it("respects budgetPeriodsOverride", () => {
    expect(getRegularPeriodsPerMonth(26, 3)).toBe(3);
  });

  it("ignores null override", () => {
    expect(getRegularPeriodsPerMonth(26, null)).toBe(2);
  });

  it("ignores zero override", () => {
    expect(getRegularPeriodsPerMonth(26, 0)).toBe(2);
  });

  it("falls back to periodsPerYear/12 for unknown period count", () => {
    expect(getRegularPeriodsPerMonth(36)).toBeCloseTo(3);
  });
});

describe("breakdownByTaxType", () => {
  it("accumulates amounts by tax type", () => {
    const accounts = [
      { taxType: "traditional", amount: 100000 },
      { taxType: "roth", amount: 50000 },
      { taxType: "traditional", amount: 25000 },
    ];
    const result = breakdownByTaxType(accounts);
    expect(result.traditional).toBe(125000);
    expect(result.roth).toBe(50000);
  });

  it("returns empty object for empty array", () => {
    expect(breakdownByTaxType([])).toEqual({});
  });

  it("handles single entry", () => {
    const result = breakdownByTaxType([{ taxType: "hsa", amount: 3000 }]);
    expect(result.hsa).toBe(3000);
  });
});
