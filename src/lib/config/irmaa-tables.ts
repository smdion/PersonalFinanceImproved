// IRMAA tiers from yearly `irmaa_brackets` passed in by the caller; 2-year MAGI lookback;
// per-person annual surcharges (Part B + D). Tiers apply at `magi > threshold`, so a MAGI exactly
// at CMS's top tier (≥ $750,000 jointly / $500,000) lands one tier low (a $1 edge, kept).

import { filingRules, type ReturnFilingStatus } from "./filing-status";

export type IrmaaBracket = {
  magiThreshold: number;
  /** Annual surcharge per person (Part B + Part D combined, above standard premium). */
  annualSurcharge: number;
};

/** IRMAA brackets by filing status, as stored (`irmaa_brackets`): the
 *  surcharge applies once MAGI is above a bracket's threshold. Cliff-based —
 *  $1 over triggers the whole tier. */
export type IrmaaBracketTable = Record<string, IrmaaBracket[]>;

function bracketsFor(
  brackets: IrmaaBracketTable,
  filingStatus: ReturnFilingStatus,
): IrmaaBracket[] {
  const b = brackets[filingRules(filingStatus).jointRow];
  if (!b || b.length === 0)
    throw new Error(`No IRMAA brackets for filing status ${filingStatus}`);
  return b;
}

/**
 * Get the annual IRMAA surcharge (per person) for a given MAGI and filing status.
 * Returns 0 if below the first tier.
 *
 * @param brackets The year's IRMAA brackets (`irmaa_brackets`, resolved).
 */
export function getIrmaaCost(
  magi: number,
  filingStatus: ReturnFilingStatus,
  brackets: IrmaaBracketTable,
): number {
  let surcharge = 0;
  for (const b of bracketsFor(brackets, filingStatus)) {
    if (magi > b.magiThreshold) surcharge = b.annualSurcharge;
  }
  return surcharge;
}

/**
 * Get the nearest IRMAA cliff above the current MAGI, or null if already above all tiers.
 *
 * @param brackets The year's IRMAA brackets (`irmaa_brackets`, resolved).
 */
export function getNextIrmaaCliff(
  magi: number,
  filingStatus: ReturnFilingStatus,
  brackets: IrmaaBracketTable,
): number | null {
  for (const b of bracketsFor(brackets, filingStatus)) {
    if (magi <= b.magiThreshold) return b.magiThreshold;
  }
  return null; // above all tiers
}
