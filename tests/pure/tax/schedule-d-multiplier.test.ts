/**
 * scheduleDGainsTax under the tax multiplier: the stacked gains tax × the
 * multiplier, at most the gains' cost at the scaled ordinary rates (line 25);
 * a year with no brackets (flat rates) keeps the unscaled gains tax.
 */
import { describe, expect, it } from "vitest";
import { computeLtcgTax, scheduleDGainsTax } from "@/lib/pure/tax/ltcg";
import {
  estimateEffectiveTaxRate,
  type WithholdingBracket,
} from "@/lib/pure/engine/tax-estimation";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import { readTaxData } from "../../helpers/tax-data";

const y2026 = readTaxData().years["2026"]!;
const mfj = y2026.withholding.tables.MFJ!.standard as WithholdingBracket[];
const ltcg = y2026.ltcg!.brackets as LtcgBracketTable;
const DEDUCTION = 32_200;

/** Ordinary income and gains across the 0%, 15% and line-25 cases. */
const CASES: [number, number][] = [
  [20_000, 30_000],
  [80_000, 40_000],
  [150_000, 40_000],
  [600_000, 250_000],
];

const ordinaryTax = (income: number, multiplier: number) =>
  income * estimateEffectiveTaxRate(income, mfj, multiplier, DEDUCTION);

describe("scheduleDGainsTax under the tax multiplier", () => {
  it.each([1, 1.5, 3])(
    "at %s, the stacked tax × the multiplier, at most line 25's scaled ordinary cost",
    (multiplier) => {
      for (const [ordinary, gains] of CASES) {
        const taxable = Math.max(0, ordinary - DEDUCTION);
        const unused = Math.max(0, DEDUCTION - ordinary);
        const stacked = computeLtcgTax(
          taxable,
          Math.max(0, gains - unused),
          "MFJ",
          ltcg,
        );
        const line25 =
          ordinaryTax(ordinary + gains, multiplier) -
          ordinaryTax(ordinary, multiplier);
        expect(
          scheduleDGainsTax(
            ordinary,
            gains,
            "MFJ",
            {
              taxBrackets: mfj,
              taxMultiplier: multiplier,
              standardDeduction: DEDUCTION,
              ltcgBrackets: ltcg,
            },
            estimateEffectiveTaxRate,
          ),
        ).toBe(Math.min(stacked * multiplier, line25));
      }
    },
  );

  it("with no brackets the gains tax is left unscaled", () => {
    for (const [ordinary, gains] of CASES) {
      const rates = {
        taxBrackets: undefined,
        standardDeduction: DEDUCTION,
        ltcgBrackets: ltcg,
      };
      expect(
        scheduleDGainsTax(
          ordinary,
          gains,
          "MFJ",
          { ...rates, taxMultiplier: 1.5 },
          estimateEffectiveTaxRate,
        ),
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
