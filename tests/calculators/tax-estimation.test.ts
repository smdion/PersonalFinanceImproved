import { describe, it, expect } from "vitest";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  computeTaxableSS,
  estimateWithdrawalTaxCost,
} from "@/lib/calculators/engine/tax-estimation";

import {
  makeDecumulationConfig,
  makeAccountBalances,
  makeTaxBuckets,
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";

describe("estimateEffectiveTaxRate", () => {
  it("returns 0 for zero income", () => {
    expect(estimateEffectiveTaxRate(0, TEST_BRACKETS)).toBe(0);
  });

  it("returns 0 for negative income", () => {
    expect(estimateEffectiveTaxRate(-10000, TEST_BRACKETS)).toBe(0);
  });

  it("returns 0 for empty brackets", () => {
    expect(estimateEffectiveTaxRate(50000, [])).toBe(0);
  });

  it("returns 0 for income in the 0% bracket", () => {
    expect(estimateEffectiveTaxRate(10000, TEST_BRACKETS)).toBe(0);
  });

  it("computes effective rate for income in 10% bracket", () => {
    // Income of 25000: first 16550 at 0%, remainder at 10%
    // Tax = 0 + (25000 - 16550) * 0.10 = 845
    // Effective = 845 / 25000 = 0.0338
    const rate = estimateEffectiveTaxRate(25000, TEST_BRACKETS);
    expect(rate).toBeCloseTo(0.0338, 3);
  });

  it("computes effective rate for higher bracket income", () => {
    // Income of 100000: falls in the 22% bracket
    // Tax = 9211.5 + (100000 - 96175) * 0.22 = 9211.5 + 841.5 = 10053
    // Effective = 10053 / 100000 ≈ 0.10053
    const rate = estimateEffectiveTaxRate(100000, TEST_BRACKETS);
    expect(rate).toBeCloseTo(0.10053, 3);
  });

  it("applies tax multiplier", () => {
    const rate1 = estimateEffectiveTaxRate(100000, TEST_BRACKETS, 1.0);
    const rate12 = estimateEffectiveTaxRate(100000, TEST_BRACKETS, 1.2);
    expect(rate12).toBeCloseTo(rate1 * 1.2, 3);
  });
});

describe("incomeCapForMarginalRate", () => {
  it("returns threshold of first bracket exceeding target rate", () => {
    // Target 0.12: first bracket with rate > 0.12 is the 22% bracket at 96175
    expect(incomeCapForMarginalRate(0.12, TEST_BRACKETS)).toBe(96175);
  });

  it("returns first bracket threshold for very low target", () => {
    // Target 0: first bracket with rate > 0 is 10% at 16550
    expect(incomeCapForMarginalRate(0, TEST_BRACKETS)).toBe(16550);
  });

  it("returns Infinity when no bracket exceeds target", () => {
    expect(incomeCapForMarginalRate(0.99, TEST_BRACKETS)).toBe(Infinity);
  });

  it("returns Infinity for empty brackets", () => {
    expect(incomeCapForMarginalRate(0.1, [])).toBe(Infinity);
  });

  it("returns correct cap for exact bracket rate match", () => {
    // Target 0.22: first bracket with rate > 0.22 is 24% at 201550
    expect(incomeCapForMarginalRate(0.22, TEST_BRACKETS)).toBe(201550);
  });
});

describe("computeTaxableSS", () => {
  describe("MFJ thresholds (tier1=32000, tier2=44000)", () => {
    it("returns 0 when provisional income below tier 1", () => {
      // Provisional = otherIncome + 0.5*SS = 10000 + 0.5*20000 = 20000 < 32000
      expect(computeTaxableSS(20000, 10000, "MFJ")).toBe(0);
    });

    it("taxes up to 50% between tier 1 and tier 2", () => {
      // Provisional = 30000 + 0.5*20000 = 40000
      // tier1Excess = min(40000-32000, 44000-32000) = min(8000, 12000) = 8000
      // taxable = min(0.5*8000, 0.5*20000) = min(4000, 10000) = 4000
      const result = computeTaxableSS(20000, 30000, "MFJ");
      expect(result).toBe(4000);
    });

    it("taxes up to 85% above tier 2", () => {
      // Provisional = 80000 + 0.5*30000 = 95000
      // tier1Excess = min(95000-32000, 12000) = 12000
      // taxable = min(0.5*12000, 0.5*30000) = min(6000, 15000) = 6000
      // tier2Excess = 95000 - 44000 = 51000
      // taxable = min(6000 + 0.85*51000, 0.85*30000) = min(49350, 25500) = 25500
      const result = computeTaxableSS(30000, 80000, "MFJ");
      expect(result).toBe(25500);
    });

    it("returns 0 for zero SS income", () => {
      expect(computeTaxableSS(0, 100000, "MFJ")).toBe(0);
    });

    it("caps at 85% of SS income", () => {
      const ss = 40000;
      const result = computeTaxableSS(ss, 500000, "MFJ");
      expect(result).toBeLessThanOrEqual(ss * 0.85);
    });
  });

  describe("Single/HOH thresholds (tier1=25000, tier2=34000)", () => {
    it("returns 0 when provisional income below tier 1", () => {
      // Provisional = 5000 + 0.5*10000 = 10000 < 25000
      expect(computeTaxableSS(10000, 5000, "Single")).toBe(0);
    });

    it("taxes between tiers", () => {
      // Provisional = 25000 + 0.5*10000 = 30000
      // tier1Excess = min(30000-25000, 34000-25000) = min(5000, 9000) = 5000
      // taxable = min(0.5*5000, 0.5*10000) = min(2500, 5000) = 2500
      expect(computeTaxableSS(10000, 25000, "Single")).toBe(2500);
    });

    it("HOH uses same thresholds as Single", () => {
      const single = computeTaxableSS(20000, 40000, "Single");
      const hoh = computeTaxableSS(20000, 40000, "HOH");
      expect(hoh).toBe(single);
    });
  });

  it("includes tax-exempt interest in provisional income", () => {
    // Without interest: provisional = 20000 + 0.5*20000 = 30000 (below 32000 MFJ tier1)
    const without = computeTaxableSS(20000, 20000, "MFJ", 0);
    expect(without).toBe(0);

    // With interest: provisional = 20000 + 0.5*20000 + 5000 = 35000 (above 32000)
    const with5k = computeTaxableSS(20000, 20000, "MFJ", 5000);
    expect(with5k).toBeGreaterThan(0);
  });
});

describe("estimateWithdrawalTaxCost", () => {
  it("returns zero tax for zero after-tax need", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 0,
      ssIncome: 20000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    expect(result.estTax).toBe(0);
    expect(result.effectiveTaxRate).toBe(0);
    expect(result.grossUpFactor).toBe(1);
    expect(result.targetWithdrawal).toBe(0);
  });

  it("computes gross-up factor for bracket_filling mode", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
    expect(result.grossedUpNeed).toBeGreaterThanOrEqual(60000);
    expect(result.targetWithdrawal).toBeGreaterThanOrEqual(60000);
  });

  it("caps target withdrawal at total balance", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 500000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets({
        preTax: 100,
        taxFree: 100,
        hsa: 100,
        afterTax: 100,
        afterTaxBasis: 50,
      }),
      acctBal: makeAccountBalances({
        preTax: 100,
        taxFree: 100,
        hsa: 100,
        afterTax: 100,
        afterTaxBasis: 50,
      }),
      totalBalance: 400,
      estTraditionalPortion: 0.25,
    });
    expect(result.targetWithdrawal).toBeLessThanOrEqual(400);
  });

  it("disables gross-up when grossUpForTaxes is false", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 0,
      filingStatus: null,
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: false,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    expect(result.grossUpFactor).toBe(1);
  });

  it("handles waterfall routing mode", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({ withdrawalRoutingMode: "waterfall" }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
    expect(result.targetWithdrawal).toBeGreaterThan(0);
  });

  it("handles percentage routing mode (fallback path)", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({ withdrawalRoutingMode: "percentage" }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
  });

  it("runs SS convergence with filing status and SS income", () => {
    // With filing status + SS income, should run 2 iterations
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 30000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
      estTraditionalPortion: 0.5,
    });
    // taxableSS should be computed via IRS formula (not flat 85%)
    expect(result.taxableSS).toBeGreaterThanOrEqual(0);
    expect(result.taxableSS).toBeLessThanOrEqual(30000 * 0.85);
  });
});
