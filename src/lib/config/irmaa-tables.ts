// IRMAA tiers from yearly `irmaa_brackets` passed in by the caller; 2-year MAGI lookback;
// per-person annual surcharges (Part B + D). Each tier applies above its threshold, the top one
// at or above it (20 CFR 418.1115: "greater than or equal to" $500,000 / $750,000 jointly).

import { roundToCents } from "../utils/math";
import { filingRules, type ReturnFilingStatus } from "./filing-status";

export type IrmaaBracket = {
  magiThreshold: number;
  /** Annual surcharge per person (Part B + Part D combined, above standard premium). */
  annualSurcharge: number;
};

/** The top tier's thresholds ($500,000 / $750,000 jointly) aren't indexed
 *  before 2028 (42 USC 1395r(i)(5)(C); 20 CFR 418.1115(e)(2)); later years
 *  index from 2027's. */
const IRMAA_TOP_TIER_HELD_THROUGH = 2027;

/** The year the top tier's threshold grows from, given its table's year
 *  (`undefined`, current data, stays `undefined`: no growth). */
export function irmaaTopTierVintage(
  tableYear: number | undefined,
): number | undefined {
  return tableYear == null
    ? undefined
    : Math.max(tableYear, IRMAA_TOP_TIER_HELD_THROUGH);
}

/** IRMAA brackets by filing status, as stored (`irmaa_brackets`): the
 *  surcharge applies once MAGI is above a bracket's threshold (the top
 *  bracket: at or above it). Cliff-based — $1 over triggers the whole tier. */
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
  const tiers = bracketsFor(brackets, filingStatus);
  let surcharge = 0;
  tiers.forEach((b, i) => {
    if (reachesTier(magi, b, i === tiers.length - 1))
      surcharge = b.annualSurcharge;
  });
  return surcharge;
}

/** Whether `magi` is in tier `b`: above its threshold, or at it for the top
 *  tier (20 CFR 418.1115(b)(3)(v), (c)(3)(v)). */
function reachesTier(magi: number, b: IrmaaBracket, top: boolean): boolean {
  return top ? magi >= b.magiThreshold : magi > b.magiThreshold;
}

/**
 * The most MAGI can be and stay under the next tier: a lower tier's threshold,
 * the top tier's less a cent; null in the top tier.
 *
 * @param brackets The year's IRMAA brackets (`irmaa_brackets`, resolved).
 */
export function getNextIrmaaCliff(
  magi: number,
  filingStatus: ReturnFilingStatus,
  brackets: IrmaaBracketTable,
): number | null {
  const tiers = bracketsFor(brackets, filingStatus);
  for (const [i, b] of tiers.entries()) {
    const top = i === tiers.length - 1;
    if (!reachesTier(magi, b, top))
      return top ? roundToCents(b.magiThreshold - 0.01) : b.magiThreshold;
  }
  return null; // in the top tier
}
