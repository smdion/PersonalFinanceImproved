/** A Roth conversion's tax: the year's tax with it less the tax without it (IRC § 408A(d)(3)). */
import { roundToCents } from "../../utils/math";
import { estimateEffectiveTaxRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";

/** The year's tables a conversion's tax is priced on. */
export interface ConversionTaxTables {
  taxBrackets: WithholdingBracket[];
  taxMultiplier?: number;
  standardDeduction?: number;
}

/** The year's tax on `income` (gross), rounded to cents. */
function yearTax(income: number, t: ConversionTaxTables): number {
  if (income <= 0) return 0;
  return roundToCents(
    income *
      estimateEffectiveTaxRate(
        income,
        t.taxBrackets,
        t.taxMultiplier,
        t.standardDeduction,
      ),
  );
}

/** The incremental tax of converting `conversion` on top of `yearTaxableIncome`:
 *  tax(income + conversion) − tax(income), not effective_rate × conversion. */
export function conversionTaxCost(
  yearTaxableIncome: number,
  conversion: number,
  t: ConversionTaxTables,
): number {
  return roundToCents(
    Math.max(
      0,
      yearTax(yearTaxableIncome + conversion, t) -
        yearTax(yearTaxableIncome, t),
    ),
  );
}
