/**
 * scaledGainsTax: the gains tax under the tax multiplier. At a multiplier
 * of 1 it is scheduleDGainsTax exactly, and a year with no brackets (flat
 * rates) keeps the unscaled gains tax whatever the multiplier.
 */
import { describe, expect, it } from "vitest";
import { scaledGainsTax } from "@/lib/pure/tax/scaled-gains-tax";
import { scheduleDGainsTax } from "@/lib/pure/tax/ltcg";
import {
  estimateEffectiveTaxRate,
  type WithholdingBracket,
} from "@/lib/pure/engine/tax-estimation";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import { readTaxData } from "../../helpers/tax-data";

const y2026 = readTaxData().years["2026"]!;
const mfj = y2026.withholding.tables.MFJ!.standard as WithholdingBracket[];
const ltcg = y2026.ltcg!.brackets as LtcgBracketTable;

/** Ordinary income and gains across the 0%, 15% and line-25 cases. */
const CASES: [number, number][] = [
  [20_000, 30_000],
  [80_000, 40_000],
  [150_000, 40_000],
  [600_000, 250_000],
];

describe("scaledGainsTax", () => {
  it("at a multiplier of 1 it is scheduleDGainsTax", () => {
    for (const [ordinary, gains] of CASES) {
      const rates = {
        taxBrackets: mfj,
        taxMultiplier: 1,
        standardDeduction: 32_200,
        ltcgBrackets: ltcg,
      };
      expect(
        scaledGainsTax(ordinary, gains, "MFJ", rates, estimateEffectiveTaxRate),
      ).toBe(
        scheduleDGainsTax(
          ordinary,
          gains,
          "MFJ",
          rates,
          estimateEffectiveTaxRate,
        ),
      );
    }
  });

  it("with no brackets the gains tax is left unscaled", () => {
    for (const [ordinary, gains] of CASES) {
      const rates = {
        taxBrackets: undefined,
        taxMultiplier: 1.5,
        standardDeduction: 32_200,
        ltcgBrackets: ltcg,
      };
      expect(
        scaledGainsTax(ordinary, gains, "MFJ", rates, estimateEffectiveTaxRate),
      ).toBe(
        scheduleDGainsTax(
          ordinary,
          gains,
          "MFJ",
          { ...rates, taxMultiplier: 1 },
          estimateEffectiveTaxRate,
        ),
      );
    }
  });
});
