// IRMAA (Income-Related Monthly Adjustment Amount) bracket tables.
// The brackets are yearly data (tax-data/us-federal.json → `irmaa_brackets`),
// passed in by the caller — none are built in.
//
// IRMAA uses a 2-year MAGI lookback — 2026 premiums are based on 2024 MAGI.
// Surcharges are per-person annual amounts (Part B + Part D combined).

import type { FilingStatusType } from "../calculators/types";

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
  filingStatus: FilingStatusType,
): IrmaaBracket[] {
  const b = brackets[filingStatus];
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
  filingStatus: FilingStatusType,
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
  filingStatus: FilingStatusType,
  brackets: IrmaaBracketTable,
): number | null {
  for (const b of bracketsFor(brackets, filingStatus)) {
    if (magi <= b.magiThreshold) return b.magiThreshold;
  }
  return null; // above all tiers
}
