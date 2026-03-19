// Long-Term Capital Gains tax brackets by filing status.
// Source: IRS Revenue Procedure 2024-40 (2025 tax year, adjusted annually).
//
// Key: LTCG brackets use total taxable income (ordinary + capital gains),
// NOT just capital gains alone.

import type { FilingStatusType } from "../calculators/types";

/** LTCG bracket entry — rate applies to gains when total taxable income is below threshold. */
type LtcgBracket = { threshold: number; rate: number };

/** 2025 LTCG brackets by filing status (thresholds adjusted annually for inflation). */
export const LTCG_BRACKETS: Record<FilingStatusType, LtcgBracket[]> = {
  MFJ: [
    { threshold: 94050, rate: 0 },
    { threshold: 583750, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  Single: [
    { threshold: 47025, rate: 0 },
    { threshold: 518900, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  HOH: [
    { threshold: 63000, rate: 0 },
    { threshold: 551350, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
};

/**
 * Get the effective LTCG tax rate based on total taxable income and filing status.
 * Uses the income level (ordinary + gains) to determine which LTCG bracket applies.
 *
 * For simplicity, returns a single rate (the marginal rate at the given income level).
 * A blended rate would be more accurate for large gains spanning brackets, but the
 * single-rate approximation is sufficient for projection purposes.
 */
export function getLtcgRate(
  totalTaxableIncome: number,
  filingStatus: FilingStatusType,
): number {
  const brackets = LTCG_BRACKETS[filingStatus];
  if (!brackets) return 0.15; // fallback
  for (const b of brackets) {
    if (totalTaxableIncome <= b.threshold) return b.rate;
  }
  return 0.2; // above all thresholds
}
