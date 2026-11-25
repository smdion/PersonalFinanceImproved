/** A year's long-term gains tax under the tax multiplier. */
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import { scheduleDGainsTax } from "./ltcg";

/** The stacked gains tax × the tax multiplier (a stand-in for state and local income tax),
 *  at most the gains' cost at the scaled ordinary rates (line 25); NIIT stays unscaled. With
 *  no brackets (flat rates) it is scheduleDGainsTax's, as the flat ordinary rate is. */
export function scaledGainsTax<Bracket>(
  grossOrdinaryIncome: number,
  gains: number,
  filingStatus: ReturnFilingStatus,
  taxRates: {
    taxBrackets?: Bracket[];
    taxMultiplier?: number;
    standardDeduction?: number;
    ltcgBrackets: LtcgBracketTable;
  },
  ordinaryRate: (
    income: number,
    brackets: Bracket[],
    taxMultiplier?: number,
    standardDeduction?: number,
  ) => number,
): number {
  const brackets = taxRates.taxBrackets;
  if (!brackets || brackets.length === 0)
    return scheduleDGainsTax(
      grossOrdinaryIncome,
      gains,
      filingStatus,
      taxRates,
      ordinaryRate,
    );
  const multiplier = taxRates.taxMultiplier ?? 1;
  const stacked = scheduleDGainsTax(
    grossOrdinaryIncome,
    gains,
    filingStatus,
    { ...taxRates, taxBrackets: undefined },
    ordinaryRate,
  );
  const ordinaryTax = (income: number) =>
    income *
    ordinaryRate(income, brackets, multiplier, taxRates.standardDeduction);
  return Math.min(
    stacked * multiplier,
    ordinaryTax(grossOrdinaryIncome + gains) - ordinaryTax(grossOrdinaryIncome),
  );
}
