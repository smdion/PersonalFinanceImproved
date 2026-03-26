import { describe, it, expect } from "vitest";
import {
  FPL_BY_HOUSEHOLD,
  getAcaSubsidyCliff,
  estimateAcaSubsidyValue,
} from "@/lib/config/aca-tables";

describe("FPL_BY_HOUSEHOLD", () => {
  it("has entries for household sizes 1-8", () => {
    for (let size = 1; size <= 8; size++) {
      expect(FPL_BY_HOUSEHOLD[size]).toBeGreaterThan(0);
    }
  });

  it("FPL increases with household size", () => {
    for (let size = 2; size <= 8; size++) {
      expect(FPL_BY_HOUSEHOLD[size]).toBeGreaterThan(
        FPL_BY_HOUSEHOLD[size - 1],
      );
    }
  });
});

describe("getAcaSubsidyCliff", () => {
  it("returns 400% of FPL for each household size", () => {
    expect(getAcaSubsidyCliff(1)).toBe(FPL_BY_HOUSEHOLD[1] * 4);
    expect(getAcaSubsidyCliff(4)).toBe(FPL_BY_HOUSEHOLD[4] * 4);
  });

  it("clamps household size to 1-8 range", () => {
    expect(getAcaSubsidyCliff(0)).toBe(FPL_BY_HOUSEHOLD[1] * 4);
    expect(getAcaSubsidyCliff(-1)).toBe(FPL_BY_HOUSEHOLD[1] * 4);
    expect(getAcaSubsidyCliff(10)).toBe(FPL_BY_HOUSEHOLD[8] * 4);
  });
});

describe("estimateAcaSubsidyValue", () => {
  it("returns 0 when MAGI exceeds the cliff", () => {
    const cliff = getAcaSubsidyCliff(2);
    expect(estimateAcaSubsidyValue(cliff, 2, 40)).toBe(0);
    expect(estimateAcaSubsidyValue(cliff + 1, 2, 40)).toBe(0);
  });

  it("returns positive subsidy below the cliff", () => {
    expect(estimateAcaSubsidyValue(30000, 1, 40)).toBeGreaterThan(0);
  });

  it("uses age-based premium brackets", () => {
    const income = 25000;
    const size = 1;
    const under50 = estimateAcaSubsidyValue(income, size, 40);
    const age50to54 = estimateAcaSubsidyValue(income, size, 52);
    const age55to59 = estimateAcaSubsidyValue(income, size, 57);
    const age60plus = estimateAcaSubsidyValue(income, size, 62);

    // Higher age = higher premium = higher subsidy
    expect(age50to54).toBeGreaterThan(under50);
    expect(age55to59).toBeGreaterThan(age50to54);
    expect(age60plus).toBeGreaterThan(age55to59);
  });

  it("applies household multiplier for size >= 2", () => {
    const income = 30000;
    const single = estimateAcaSubsidyValue(income, 1, 40);
    const couple = estimateAcaSubsidyValue(income, 2, 40);
    expect(couple).toBeGreaterThan(single);
  });

  it("varies contribution rate by FPL ratio", () => {
    const size = 1;
    const age = 40;
    const fpl = FPL_BY_HOUSEHOLD[1];

    // Very low income (<=1.5x FPL) gets highest subsidy
    const veryLow = estimateAcaSubsidyValue(fpl * 1.3, size, age);
    // Higher income (3.0-4.0x FPL) gets lower subsidy
    const higher = estimateAcaSubsidyValue(fpl * 3.5, size, age);
    expect(veryLow).toBeGreaterThan(higher);
  });

  it("never returns negative", () => {
    // Even at high income just below cliff, subsidy should be >= 0
    const cliff = getAcaSubsidyCliff(1);
    expect(estimateAcaSubsidyValue(cliff - 1, 1, 40)).toBeGreaterThanOrEqual(0);
  });
});
