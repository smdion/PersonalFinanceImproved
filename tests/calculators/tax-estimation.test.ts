import { describe, it, expect } from "vitest";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  computeTaxableSS,
  computeTaxFromSlots,
} from "@/lib/calculators/engine/tax-estimation";

import { makeTaxBuckets, TEST_BRACKETS } from "./fixtures/engine-fixtures";
import type { DecumulationSlot } from "@/lib/calculators/types";

function makeSlot(
  category: DecumulationSlot["category"],
  overrides: Partial<DecumulationSlot> = {},
): DecumulationSlot {
  return {
    category,
    withdrawal: 0,
    rothWithdrawal: 0,
    traditionalWithdrawal: 0,
    cappedByAccount: false,
    cappedByTaxType: false,
    remainingNeed: 0,
    ...overrides,
  };
}

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

describe("computeTaxFromSlots", () => {
  const baseTaxRates = {
    traditionalFallbackRate: 0.15,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
    taxBrackets: TEST_BRACKETS,
  };

  it("returns zero tax cost for empty slots", () => {
    const result = computeTaxFromSlots({
      slots: [],
      taxableSS: 0,
      balances: makeTaxBuckets(),
      taxRates: baseTaxRates,
      filingStatus: "MFJ",
    });
    expect(result.taxCost).toBe(0);
    expect(result.totalTraditionalWithdrawal).toBe(0);
  });

  it("taxes a traditional withdrawal at the bracket-estimated rate", () => {
    const slots = [
      makeSlot("401k", { withdrawal: 25000, traditionalWithdrawal: 25000 }),
    ];
    const result = computeTaxFromSlots({
      slots,
      taxableSS: 0,
      balances: makeTaxBuckets(),
      taxRates: baseTaxRates,
      filingStatus: "MFJ",
    });
    // Same bracket math as estimateEffectiveTaxRate's own pinned test:
    // income 25000 -> effective rate ~0.0338
    expect(result.actualTraditionalRate).toBeCloseTo(0.0338, 3);
    expect(result.taxCost).toBeCloseTo(25000 * result.actualTraditionalRate, 2);
  });

  it("splits brokerage withdrawal into basis (tax-free) and gains (taxed)", () => {
    const slots = [makeSlot("brokerage", { withdrawal: 10000 })];
    const result = computeTaxFromSlots({
      slots,
      taxableSS: 0,
      // afterTax 100k, basis 40k -> 40% of any brokerage withdrawal is basis
      balances: { afterTax: 100000, afterTaxBasis: 40000 },
      taxRates: baseTaxRates,
      filingStatus: null, // no filingStatus -> flat taxRates.brokerage rate
    });
    expect(result.brokerageBasisPortion).toBeCloseTo(4000, 2);
    expect(result.brokerageGainsPortion).toBeCloseTo(6000, 2);
    expect(result.brokerageTaxCost).toBeCloseTo(6000 * 0.15, 2);
    expect(result.taxCost).toBeCloseTo(result.brokerageTaxCost, 2);
  });

  it("Roth and HSA withdrawals are tax-free by default", () => {
    const slots = [
      makeSlot("403b", { withdrawal: 10000, rothWithdrawal: 10000 }),
      makeSlot("hsa", { withdrawal: 5000 }),
    ];
    const result = computeTaxFromSlots({
      slots,
      taxableSS: 0,
      balances: makeTaxBuckets(),
      taxRates: baseTaxRates,
      filingStatus: "MFJ",
    });
    expect(result.taxCost).toBe(0);
  });

  it("sums traditional + roth + hsa + brokerage tax into one taxCost", () => {
    const slots = [
      makeSlot("401k", { withdrawal: 20000, traditionalWithdrawal: 20000 }),
      makeSlot("403b", { withdrawal: 5000, rothWithdrawal: 5000 }),
      makeSlot("brokerage", { withdrawal: 8000 }),
    ];
    const result = computeTaxFromSlots({
      slots,
      taxableSS: 0,
      balances: { afterTax: 80000, afterTaxBasis: 0 }, // 0 basis -> all gains
      taxRates: { ...baseTaxRates, roth: 0.1 },
      filingStatus: null,
    });
    const expectedTraditionalTax = 20000 * result.actualTraditionalRate;
    const expectedRothTax = 5000 * 0.1;
    const expectedBrokerageTax = 8000 * 0.15; // all gains, flat rate (no filingStatus)
    expect(result.taxCost).toBeCloseTo(
      expectedTraditionalTax + expectedRothTax + expectedBrokerageTax,
      2,
    );
  });

  describe("rothTaxableGrowth (v0.7.8 Roth-tax-basis follow-up)", () => {
    it("undefined rothTaxableGrowth reduces to today's flat-rate behavior (acceptance criterion 1)", () => {
      const slots = [
        makeSlot("403b", { withdrawal: 10000, rothWithdrawal: 10000 }),
      ];
      const withField = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: { ...baseTaxRates, roth: 0.1 },
        filingStatus: "MFJ",
      });
      const withoutField = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: { ...baseTaxRates, roth: 0.1 },
        filingStatus: "MFJ",
        rothTaxableGrowth: undefined,
      });
      expect(withField.taxCost).toBe(withoutField.taxCost);
      expect(withField.rothTaxableGrowth).toBe(0);
      expect(withField.rothTaxFreePortion).toBe(10000);
    });

    it("taxes the taxable-growth portion at the traditional rate, and the rest at taxRates.roth", () => {
      const slots = [
        makeSlot("403b", { withdrawal: 10000, rothWithdrawal: 10000 }),
      ];
      const result = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: { ...baseTaxRates, roth: 0 },
        filingStatus: "MFJ",
        rothTaxableGrowth: 4000,
      });
      expect(result.rothTaxableGrowth).toBe(4000);
      expect(result.rothTaxFreePortion).toBe(6000);
      // No traditional withdrawal, so actualTaxableIncome = rothTaxableGrowth (4000).
      expect(result.actualTraditionalRate).toBeCloseTo(
        computeTaxFromSlots({
          slots: [
            makeSlot("401k", {
              withdrawal: 4000,
              traditionalWithdrawal: 4000,
            }),
          ],
          taxableSS: 0,
          balances: makeTaxBuckets(),
          taxRates: baseTaxRates,
          filingStatus: "MFJ",
        }).actualTraditionalRate,
        6,
      );
      expect(result.taxCost).toBeCloseTo(
        4000 * result.actualTraditionalRate,
        2,
      );
    });

    it("conservation: rothTaxableGrowth + rothTaxFreePortion === totalRothWithdrawal", () => {
      const slots = [
        makeSlot("403b", { withdrawal: 15000, rothWithdrawal: 15000 }),
      ];
      const result = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: baseTaxRates,
        filingStatus: "MFJ",
        rothTaxableGrowth: 6500,
      });
      expect(result.rothTaxableGrowth + result.rothTaxFreePortion).toBeCloseTo(
        result.totalRothWithdrawal,
        2,
      );
    });

    it("pushes actualTaxableIncome (and so actualTraditionalRate) above the traditional-only base — acceptance criterion 7", () => {
      const slots = [
        makeSlot("401k", { withdrawal: 60000, traditionalWithdrawal: 60000 }),
        makeSlot("403b", { withdrawal: 20000, rothWithdrawal: 20000 }),
      ];
      const withoutGrowth = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: baseTaxRates,
        filingStatus: "MFJ",
      });
      const withGrowth = computeTaxFromSlots({
        slots,
        taxableSS: 0,
        balances: makeTaxBuckets(),
        taxRates: baseTaxRates,
        filingStatus: "MFJ",
        rothTaxableGrowth: 20000,
      });
      expect(withGrowth.actualTraditionalRate).toBeGreaterThan(
        withoutGrowth.actualTraditionalRate,
      );
      expect(withGrowth.taxCost).toBeGreaterThan(withoutGrowth.taxCost);
    });
  });
});
