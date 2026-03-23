// Net Investment Income Tax (NIIT) — IRC §1411
// AKA the "3.8% surtax" — enacted by the ACA in 2013.
//
// Applies to: the LESSER of
//   (a) net investment income, OR
//   (b) MAGI exceeding the threshold
//
// Thresholds are NOT indexed to inflation (like SS taxation thresholds
// and Medicare surtax). More filers hit this each year due to bracket creep.
//
// Key interactions:
//   - Roth conversions are NOT net investment income, but they raise MAGI,
//     which can push (b) above threshold and trigger NIIT on existing investment income.
//   - Capital gains (LTCG + STCG) ARE net investment income.
//   - Rental income, dividends, interest ARE net investment income.
//   - Wages, SS benefits, IRA/401k distributions are NOT net investment income.

import type { FilingStatusType } from "../calculators/types";

/** NIIT rate — fixed at 3.8% since enactment (2013). */
export const NIIT_RATE = 0.038;

/** MAGI thresholds by filing status — not indexed to inflation (IRC §1411(b)). */
export const NIIT_THRESHOLDS: Record<FilingStatusType, number> = {
  MFJ: 250000,
  Single: 200000,
  HOH: 200000,
};

/**
 * Compute Net Investment Income Tax (3.8% surtax).
 *
 * NIIT = 3.8% × min(netInvestmentIncome, max(0, magi - threshold))
 *
 * @param magi Modified Adjusted Gross Income (includes Roth conversions, SS, gains, etc.)
 * @param netInvestmentIncome Investment income subject to NIIT (capital gains, dividends, interest, rental)
 *        In our projection model, this is primarily brokerage gains (LTCG).
 * @param filingStatus Filing status for threshold lookup.
 * @returns NIIT amount (0 if below threshold or no investment income).
 */
export function computeNiit(
  magi: number,
  netInvestmentIncome: number,
  filingStatus: FilingStatusType,
): number {
  if (netInvestmentIncome <= 0) return 0;

  const threshold = NIIT_THRESHOLDS[filingStatus];
  const magiExcess = Math.max(0, magi - threshold);
  if (magiExcess <= 0) return 0;

  const taxableAmount = Math.min(netInvestmentIncome, magiExcess);
  return Math.round(taxableAmount * NIIT_RATE * 100) / 100;
}
