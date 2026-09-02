// IRMAA (Income-Related Monthly Adjustment Amount) bracket tables.
// Source: CMS Medicare Part B/D premium adjustments, 2026 thresholds (projected).
//
// IRMAA uses a 2-year MAGI lookback — 2026 premiums are based on 2024 MAGI.
// Surcharges are per-person annual amounts (Part B + Part D combined).

import type { FilingStatusType } from "../calculators/types";

/** Medicare eligibility age. IRMAA surcharges apply from this age onward; it also backs ACA subsidy-eligibility checks elsewhere, since losing Medicare eligibility is the marketplace-subsidy criterion. */
export const MEDICARE_START_AGE = 65;

/**
 * Calendar year `IRMAA_BRACKETS` below represents (see its own docblock:
 * "2026 projected thresholds"). Deliberately its OWN constant, not shared
 * with `distributionTaxRates.taxDataYear` (the ordinary tax bracket
 * table's vintage) — the two tables come from independent sources with
 * no reason to share a vintage, and Phase 1's `taxDataYear` sharing was
 * only correct there because `toOrdinaryBracketIncome`'s residual math
 * genuinely couples `standardDeduction` and `taxBrackets` (see
 * `bracket-growth.ts`'s `growWithholdingBrackets` docblock). IRMAA has no
 * such coupling; borrowing another table's vintage would silently
 * mis-grow this one whenever the two tables' real vintages drift apart
 * (`tests/config/tax-freshness.test.ts` already tracks known DB/seed
 * mislabeling for exactly this reason).
 */
export const IRMAA_DATA_YEAR = 2026;

export type IrmaaBracket = {
  magiThreshold: number;
  /** Annual surcharge per person (Part B + Part D combined, above standard premium). */
  annualSurcharge: number;
};

/**
 * IRMAA brackets by filing status. Each entry means: if MAGI exceeds
 * this threshold, the surcharge applies. Brackets are cliff-based —
 * going $1 over triggers the full surcharge for that tier.
 *
 * 2026 projected thresholds (indexed to 2025 + CPI adjustment).
 */
export const IRMAA_BRACKETS: Record<FilingStatusType, IrmaaBracket[]> = {
  MFJ: [
    { magiThreshold: 206000, annualSurcharge: 1056 }, // Tier 1: ~$88/mo
    { magiThreshold: 258000, annualSurcharge: 2640 }, // Tier 2: ~$220/mo
    { magiThreshold: 322000, annualSurcharge: 4224 }, // Tier 3: ~$352/mo
    { magiThreshold: 386000, annualSurcharge: 5808 }, // Tier 4: ~$484/mo
    { magiThreshold: 750000, annualSurcharge: 6924 }, // Tier 5: ~$577/mo
  ],
  Single: [
    { magiThreshold: 103000, annualSurcharge: 1056 },
    { magiThreshold: 129000, annualSurcharge: 2640 },
    { magiThreshold: 161000, annualSurcharge: 4224 },
    { magiThreshold: 193000, annualSurcharge: 5808 },
    { magiThreshold: 375000, annualSurcharge: 6924 },
  ],
  HOH: [
    { magiThreshold: 103000, annualSurcharge: 1056 },
    { magiThreshold: 129000, annualSurcharge: 2640 },
    { magiThreshold: 161000, annualSurcharge: 4224 },
    { magiThreshold: 193000, annualSurcharge: 5808 },
    { magiThreshold: 375000, annualSurcharge: 6924 },
  ],
};

/**
 * Get the annual IRMAA surcharge (per person) for a given MAGI and filing status.
 * Returns 0 if below the first tier.
 *
 * @param dbBrackets Optional DB-loaded brackets (overrides hardcoded defaults).
 */
export function getIrmaaCost(
  magi: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, IrmaaBracket[]>,
): number {
  const brackets = (dbBrackets ?? IRMAA_BRACKETS)[filingStatus];
  if (!brackets) return 0;
  let surcharge = 0;
  for (const b of brackets) {
    if (magi > b.magiThreshold) surcharge = b.annualSurcharge;
  }
  return surcharge;
}

/**
 * Get the nearest IRMAA cliff above the current MAGI, or null if already above all tiers.
 *
 * @param dbBrackets Optional DB-loaded brackets (overrides hardcoded defaults).
 */
export function getNextIrmaaCliff(
  magi: number,
  filingStatus: FilingStatusType,
  dbBrackets?: Record<string, IrmaaBracket[]>,
): number | null {
  const brackets = (dbBrackets ?? IRMAA_BRACKETS)[filingStatus];
  if (!brackets) return null;
  for (const b of brackets) {
    if (magi <= b.magiThreshold) return b.magiThreshold;
  }
  return null; // above all tiers
}
