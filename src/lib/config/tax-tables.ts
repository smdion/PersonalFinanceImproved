// Long-Term Capital Gains tax brackets by filing status.
// Source: IRS Revenue Procedure 2025-32 (2026 tax year, adjusted annually).
//
// Key: LTCG brackets use total taxable income (ordinary + capital gains),
// NOT just capital gains alone.

import type { FilingStatusType } from "../calculators/types";

/** LTCG bracket entry — rate applies to gains when total taxable income is below threshold. */
type LtcgBracket = { threshold: number; rate: number };

/** 2026 LTCG brackets by filing status (thresholds adjusted annually for inflation). */
export const LTCG_BRACKETS: Record<FilingStatusType, LtcgBracket[]> = {
  MFJ: [
    { threshold: 98900, rate: 0 },
    { threshold: 613700, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  Single: [
    { threshold: 49450, rate: 0 },
    { threshold: 545500, rate: 0.15 },
    { threshold: Infinity, rate: 0.2 },
  ],
  HOH: [
    { threshold: 66200, rate: 0 },
    { threshold: 579600, rate: 0.15 },
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
 *
 * @param dbBrackets Optional DB-loaded brackets (overrides hardcoded defaults).
 *                   Thresholds use null for Infinity (top bracket).
 */
export function getLtcgRate(
  totalTaxableIncome: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  // Use DB brackets if provided, falling back to hardcoded defaults
  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return 0.15; // fallback
  // Normalize null thresholds to Infinity (DB stores null for top bracket)
  const brackets = raw.map((b) => ({
    threshold: b.threshold ?? Infinity,
    rate: b.rate,
  }));
  for (const b of brackets) {
    if (totalTaxableIncome <= b.threshold) return b.rate;
  }
  return 0.2; // above all thresholds
}

/**
 * Compute progressive LTCG tax by stacking capital gains on top of ordinary income.
 *
 * LTCG brackets are based on total taxable income (ordinary + gains). Gains sit on
 * top of ordinary income in the bracket stack, so low-income filers may have some
 * gains in the 0% bracket even if they also have gains in the 15% bracket.
 *
 * Example (MFJ 2026, thresholds $98,900 / $613,700):
 *   ordinary = $80,000, gains = $30,000
 *   → $18,900 of gains taxed at 0% (fills up to $98,900)
 *   → $11,100 of gains taxed at 15%
 *   → total tax = $1,665  (vs. flat 15% × $30k = $4,500)
 *
 * @returns The total LTCG tax amount (not a rate).
 */
export function computeLtcgTax(
  ordinaryTaxableIncome: number,
  capitalGains: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, { threshold: number | null; rate: number }[]>,
): number {
  if (capitalGains <= 0) return 0;

  const raw = dbBrackets
    ? dbBrackets[filingStatus]
    : LTCG_BRACKETS[filingStatus];
  if (!raw) return capitalGains * 0.15; // fallback

  const brackets = raw.map((b) => ({
    threshold: b.threshold ?? Infinity,
    rate: b.rate,
  }));

  let tax = 0;
  let gainsRemaining = capitalGains;
  // "floor" is the bottom of the current bracket segment for gains
  let floor = Math.max(0, ordinaryTaxableIncome);

  for (const b of brackets) {
    if (gainsRemaining <= 0) break;
    if (floor >= b.threshold) continue; // ordinary income already past this bracket

    const room = b.threshold - floor;
    const taxable = Math.min(gainsRemaining, room);
    tax += taxable * b.rate;
    gainsRemaining -= taxable;
    floor += taxable;
  }

  return Math.round(tax * 100) / 100; // round to cents
}
