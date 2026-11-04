import { describe, it, expect } from "vitest";
import { getAcaSubsidyCliff } from "@/lib/config/aca-tables";
import { shippedTaxTables } from "../helpers/tax-data";

/** The shipped 2026 coverage-year poverty levels. */
const FPL = shippedTaxTables(2026).fplByHousehold;

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
