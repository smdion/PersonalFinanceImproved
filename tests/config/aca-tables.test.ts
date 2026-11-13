import { describe, it, expect } from "vitest";
import { acaHouseholdSize, getAcaSubsidyCliff } from "@/lib/config/aca-tables";
import { shippedTaxTables } from "../helpers/tax-data";

/** The shipped 2026 coverage-year poverty levels. */
const FPL = shippedTaxTables(2026).fplByHousehold;

// 26 USC 36B(d)(1): the family is the taxpayer, a spouse on a joint return and
// the dependents claimed. Head of household (IRC 2(b)) and qualifying surviving
// spouse (IRC 2(a)) each need a qualifying person, so their family is two or more.
describe("acaHouseholdSize: the return's family when no size is stated", () => {
  it("one person filing Single is a family of one", () => {
    expect(acaHouseholdSize(1, "Single")).toBe(1);
  });

  it("one person filing HOH or QSS is a family of two", () => {
    expect(acaHouseholdSize(1, "HOH")).toBe(2);
    expect(acaHouseholdSize(1, "QSS")).toBe(2);
  });

  it("one person entered on a joint return is a family of two", () => {
    expect(acaHouseholdSize(1, "MFJ")).toBe(2);
  });

  it("more people than the return's minimum count, up to the largest size", () => {
    expect(acaHouseholdSize(3, "MFJ")).toBe(3);
    expect(acaHouseholdSize(20, "Single")).toBe(12);
  });

  it("with the people unknown, the return's family", () => {
    expect(acaHouseholdSize(undefined, "MFJ")).toBe(2);
    expect(acaHouseholdSize(undefined, "Single")).toBe(1);
  });

  it("with no status known, the people alone", () => {
    expect(acaHouseholdSize(1, null)).toBe(1);
    expect(acaHouseholdSize(2, undefined)).toBe(2);
  });
});

describe("getAcaSubsidyCliff", () => {
  it("returns 400% of FPL for each household size", () => {
    expect(getAcaSubsidyCliff(1, FPL)).toBe(FPL[1]! * 4);
    expect(getAcaSubsidyCliff(4, FPL)).toBe(FPL[4]! * 4);
  });

  it("treats a size under 1 as 1", () => {
    expect(getAcaSubsidyCliff(0, FPL)).toBe(FPL[1]! * 4);
    expect(getAcaSubsidyCliff(-1, FPL)).toBe(FPL[1]! * 4);
  });

  it("adds HHS's per-person step (size 8 − size 7) for each person over 8", () => {
    const step = FPL[8]! - FPL[7]!;
    expect(step).toBeGreaterThan(0);
    expect(getAcaSubsidyCliff(9, FPL)).toBe((FPL[8]! + step) * 4);
    expect(getAcaSubsidyCliff(10, FPL)).toBe((FPL[8]! + 2 * step) * 4);
  });

  it("throws on a missing household size (never borrows another's)", () => {
    expect(() => getAcaSubsidyCliff(3, { 1: 15650, 2: 21150 })).toThrow(
      /household of 3/,
    );
  });
});

describe("getAcaSubsidyCliff — reads the table it's given (R43)", () => {
  it("uses the passed fpl_by_household map", () => {
    const table = { 1: 20000, 2: 30000 };
    expect(getAcaSubsidyCliff(1, table)).toBe(80000); // 20000 * 4
    expect(getAcaSubsidyCliff(2, table)).toBe(120000);
  });
});
