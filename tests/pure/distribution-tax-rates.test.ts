/** Distribution tax rates and deductions for the engine. Invented figures only. */
import { describe, it, expect } from "vitest";
import { buildDistributionTaxRates } from "@/lib/pure/distribution-tax-rates";

const settings = {
  distributionTaxRateTraditional: "0.2",
  distributionTaxRateBrokerage: "0.15",
  distributionTaxRateRoth: "0",
  distributionTaxRateHsa: null,
  taxMultiplier: "1",
  grossUpForTaxes: true,
  rothBracketTarget: "0.12",
  enableRothConversions: false,
  rothConversionTarget: null,
};
const limitsMap = {
  standard_deduction_mfj: 30000,
  additional_std_deduction_65_married: 1500,
  additional_std_deduction_65_unmarried: 2000,
};
const base = {
  settings,
  filingStatus: "MFJ" as const,
  limitsMap,
  bracketData: [],
  ltcgBracketData: undefined,
  irmaaBracketData: undefined,
  fplByHousehold: undefined,
  latestTaxYear: 2026,
  taxParamsVersion: 1,
  accumulationExpenses: 80000,
  decumulationExpenses: 80000,
  annualExpensesVal: 80000,
};

describe("buildDistributionTaxRates", () => {
  it("uses the household's flat rates when no brackets are seeded", () => {
    const r = buildDistributionTaxRates(base);
    expect(r.traditionalFallbackRate).toBe(0.2);
    expect(r.brokerage).toBe(0.15);
    expect(r.hsa).toBe(0);
    expect(r.taxBrackets).toBeUndefined();
    expect(r.standardDeduction).toBe(30000);
    expect(r.additionalStdDeduction65PerSenior).toBe(1500);
    expect(r.taxDataYear).toBe(2026);
  });

  it("estimates the fallback rate from the year's brackets when seeded", () => {
    const r = buildDistributionTaxRates({
      ...base,
      bracketData: [
        { threshold: 20000, baseWithholding: 0, rate: 0.1 },
        { threshold: 90000, baseWithholding: 2000, rate: 0.12 },
        { threshold: Infinity, baseWithholding: 10400, rate: 0.22 },
      ],
    });
    expect(r.traditionalFallbackRate).toBeGreaterThan(0);
    expect(r.traditionalFallbackRate).toBeLessThan(0.12);
    expect(r.taxBrackets).toHaveLength(3);
  });

  it("an expired senior deduction degrades to none; a missing standard deduction fails loudly", () => {
    expect(
      buildDistributionTaxRates(base).obbbaSeniorDeductionPerPerson,
    ).toBeUndefined();
    expect(() => buildDistributionTaxRates({ ...base, limitsMap: {} })).toThrow(
      /standard_deduction_mfj/,
    );
  });
});
