/**
 * Answer key, the Projection's rate lookups (v0.10.5 overnight batch):
 * the effective rate on a year's ordinary income (TAX-13), and the
 * marginal rate and the income cap for a target rate (TAX-14). Both read
 * the Pub 15-T standard withholding table and take the return's whole
 * deduction ([^tax-c]: the table is the 1040 schedule moved by the
 * standard deduction), so on the same year and income they must give the
 * Form 1040 figure. Every expected figure is worked by hand on the 1040
 * rate schedule first, never on the withholding table or from `src/`.
 * Invented households only.
 *
 * Citations: Rev. Proc. 2025-32 (RP25, 2026) § 4.01 Tables 1 and 3 (MFJ
 * and Single schedules, as written out in `tax/answer-key-tax-rates`),
 * § 4.14(1) (standard deduction $32,200 MFJ, $16,100 Single) and § 4.14(3)
 * (the 65+ add-on, $1,650 married, $2,050 unmarried); IRC 63(c), (f).
 * Gross ordinary income less the deduction is line 15 taxable income;
 * the rate is the schedule's tax on it over gross income (the engine's
 * own denominator, documented on `estimateEffectiveTaxRate`).
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { readTaxData } from "../../helpers/tax-data";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  marginalRateAtIncome,
  type WithholdingBracket,
} from "@/lib/pure/engine/tax-estimation";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

/** The 2026 Pub 15-T standard table, as shipped (the input). */
function table(status: ReturnFilingStatus): WithholdingBracket[] {
  const t = readTaxData().years["2026"]!.withholding.tables[status];
  if (!t) throw new Error(`no 2026 ${status} table`);
  return t.standard as WithholdingBracket[];
}

describe("answer key: the Projection's effective rate", () => {
  it("tax/TAX13-1 [TAX-13] MFJ, $100,000 ordinary, the basic deduction", () => {
    // TI 100,000 − 32,200 = 67,800. RP25 MFJ: 2,480 + 12% × (67,800 −
    // 24,800) = 2,480 + 5,160 = 7,640.00. Rate 7,640 / 100,000 = 0.0764.
    cents(
      estimateEffectiveTaxRate(100_000, table("MFJ"), 1, 32_200) * 100_000,
      7_640,
    );
  });

  it("tax/TAX13-2 [TAX-13] MFJ both 65+, the add-ons in the deduction", () => {
    // Deduction 32,200 + 2 × 1,650 = 35,500. TI 100,000 − 35,500 =
    // 64,500: 2,480 + 12% × 39,700 = 2,480 + 4,764 = 7,244.00.
    cents(
      estimateEffectiveTaxRate(100_000, table("MFJ"), 1, 35_500) * 100_000,
      7_244,
    );
  });

  it("tax/TAX13-3 [TAX-13] Single, $250,000, a tax multiplier of 1.2", () => {
    // TI 250,000 − 16,100 = 233,900. RP25 Single: over 201,775, not over
    // 256,225: 41,024 + 32% × 32,125 = 41,024 + 10,280 = 51,304.00. × 1.2
    // (the plan's tax-rise setting scales the tax) = 61,564.80.
    cents(
      estimateEffectiveTaxRate(250_000, table("Single"), 1.2, 16_100) * 250_000,
      61_564.8,
    );
  });

  it("tax/TAX13-4 [TAX-13] income inside the deduction: no tax", () => {
    // Single, 15,000 < 16,100: TI 0, rate 0.
    expect(estimateEffectiveTaxRate(15_000, table("Single"), 1, 16_100)).toBe(
      0,
    );
  });
});

describe("answer key: the Projection's marginal rate and rate caps", () => {
  it("tax/TAX14-1 [TAX-14] the band a gross income's taxable income falls in", () => {
    // MFJ 150,000: TI 117,800, over 100,800: 22%. Single 60,000: TI
    // 43,900, over 12,400 not over 50,400: 12%. Single 16,000: TI 0: 0.
    expect([
      marginalRateAtIncome(150_000, table("MFJ"), 32_200),
      marginalRateAtIncome(60_000, table("Single"), 16_100),
      marginalRateAtIncome(16_000, table("Single"), 16_100),
    ]).toEqual([0.22, 0.12, 0]);
  });

  it("tax/TAX14-2 [TAX-14] the gross income that fills a band", () => {
    // The 12% band's top in gross income is its taxable top plus the
    // deduction: MFJ 100,800 + 32,200 = 133,000. Single 22% band: 105,700
    // + 16,100 = 121,800; 24%: 201,775 + 16,100 = 217,875. Single 65+
    // (16,100 + 2,050 = 18,150), 12%: 50,400 + 18,150 = 68,550. Past the
    // top rate there's no cap.
    cents(
      {
        mfj12: incomeCapForMarginalRate(0.12, table("MFJ"), 32_200),
        single22: incomeCapForMarginalRate(0.22, table("Single"), 16_100),
        single24: incomeCapForMarginalRate(0.24, table("Single"), 16_100),
        senior12: incomeCapForMarginalRate(0.12, table("Single"), 18_150),
      },
      {
        mfj12: 133_000,
        single22: 121_800,
        single24: 217_875,
        senior12: 68_550,
      },
    );
    expect(incomeCapForMarginalRate(0.37, table("MFJ"), 32_200)).toBe(Infinity);
  });
});
