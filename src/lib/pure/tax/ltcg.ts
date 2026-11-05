/** Gross ordinary income (before any deduction) to the taxable income the LTCG
 *  brackets stack on: less the standard deduction, senior additions included
 *  (undefined subtracts nothing). Every LTCG-stacking site converts here. */
export function toLtcgTaxableIncome(
  grossOrdinaryIncome: number,
  standardDeduction: number | undefined,
): number {
  return Math.max(0, grossOrdinaryIncome - (standardDeduction ?? 0));
}
