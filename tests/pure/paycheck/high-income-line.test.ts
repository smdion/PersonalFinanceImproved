import { describe, it, expect } from "vitest";
import { defaultHighIncomeLine } from "@/lib/pure/paycheck/high-income-line";
import { isHighIncomeHousehold } from "@/lib/pure/contributions/savings-rate";
import { HIGH_INCOME_LINE } from "@/lib/config/milestones";

describe("defaultHighIncomeLine", () => {
  it("married filing jointly gets the household line", () => {
    expect(defaultHighIncomeLine("MFJ", 1)).toEqual({
      threshold: HIGH_INCOME_LINE.married,
      basis: "MFJ",
    });
  });

  it("Single and Head of household get the single line", () => {
    expect(defaultHighIncomeLine("Single", 2).threshold).toBe(
      HIGH_INCOME_LINE.single,
    );
    expect(defaultHighIncomeLine("HOH", 2).threshold).toBe(
      HIGH_INCOME_LINE.single,
    );
  });

  it("without a status, two or more people read as a couple", () => {
    expect(defaultHighIncomeLine(null, 2)).toEqual({
      threshold: HIGH_INCOME_LINE.married,
      basis: "people",
    });
    expect(defaultHighIncomeLine(null, 1).threshold).toBe(
      HIGH_INCOME_LINE.single,
    );
    expect(defaultHighIncomeLine(null, 0).threshold).toBe(
      HIGH_INCOME_LINE.single,
    );
  });
});

describe("isHighIncomeHousehold", () => {
  it("flips at the single line for one filer", () => {
    const { threshold } = defaultHighIncomeLine("Single", 1);
    expect(isHighIncomeHousehold(99_999, threshold)).toBe(false);
    expect(isHighIncomeHousehold(100_000, threshold)).toBe(true);
  });

  it("a line not known yet is never crossed", () => {
    expect(isHighIncomeHousehold(1_000_000, undefined)).toBe(false);
  });
});
