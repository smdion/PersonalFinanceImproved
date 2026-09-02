import { describe, it, expect } from "vitest";
import {
  FPL_BY_HOUSEHOLD,
  getAcaSubsidyCliff,
  acaMagi,
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

describe("acaMagi", () => {
  it("includes non-qualified Roth growth income in MAGI (advisor-caught 2026-09-01)", () => {
    // A household with a real non-qualified Roth growth draw: MAGI must
    // include it like any other ordinary income, matching
    // currentYearMagi's own computation (decumulation-year.ts) and NIIT's.
    // Omitting it previously let acaSubsidyPreserved read true across a
    // cliff that was really crossed.
    const withoutGrowth = acaMagi({
      totalTraditionalWithdrawal: 30000,
      rothConversionAmount: 0,
      brokerageGainsPortion: 0,
      rothTaxableGrowth: 0,
      ssIncome: 20000,
    });
    const withGrowth = acaMagi({
      totalTraditionalWithdrawal: 30000,
      rothConversionAmount: 0,
      brokerageGainsPortion: 0,
      rothTaxableGrowth: 15000,
      ssIncome: 20000,
    });
    expect(withGrowth).toBe(withoutGrowth + 15000);
    expect(withGrowth).toBe(65000);
  });

  it("sums every ordinary-income component", () => {
    expect(
      acaMagi({
        totalTraditionalWithdrawal: 10000,
        rothConversionAmount: 5000,
        brokerageGainsPortion: 2000,
        rothTaxableGrowth: 1000,
        ssIncome: 3000,
      }),
    ).toBe(21000);
  });
});

describe("getAcaSubsidyCliff — DB FPL override (R43)", () => {
  it("uses a passed fpl_by_household map instead of the hardcoded fallback", () => {
    const override = { 1: 20000, 2: 30000 };
    expect(getAcaSubsidyCliff(1, override)).toBe(80000); // 20000 * 4
    expect(getAcaSubsidyCliff(2, override)).toBe(120000);
  });

  it("falls back to FPL_BY_HOUSEHOLD when no override is given", () => {
    expect(getAcaSubsidyCliff(1)).toBe(FPL_BY_HOUSEHOLD[1]! * 4);
  });
});
