// IRMAA tiers from yearly `irmaa_brackets` passed in by the caller; 2-year MAGI lookback;
// per-person annual surcharges (Part B + D). Each tier applies above its threshold, the top one
// at or above it (20 CFR 418.1115: "greater than or equal to" $500,000 / $750,000 jointly).

import { roundToCents } from "../utils/math";
import { filingRules, type ReturnFilingStatus } from "./filing-status";

export type IrmaaBracket = {
  magiThreshold: number;
  /** Annual surcharge per person (Part B + Part D combined, above standard premium). */
  annualSurcharge: number;
  /** Whether this row is the statutory top tier, set when a table grows
   *  (`growIrmaaBrackets`), since a grown threshold can't show it. A stored
   *  row has none; its threshold decides (`irmaaTopTierIndex`). */
  topTier?: boolean;
};

/** The lowest the top tier's threshold can be, by table row: $500,000,
 *  $750,000 jointly (20 CFR 418.1115(b)(5), (c)(5)), held through 2027 and
 *  indexed upward after. No ordinary tier is near it. */
const IRMAA_TOP_TIER_FLOOR: Readonly<Record<string, number>> = {
  Single: 500_000,
  HOH: 500_000,
  MFJ: 750_000,
};

/** The index of a row's statutory top tier, or -1: the last tier, when a
 *  grown table marks it or a stored one's threshold reaches the floor. A table
 *  without it (user-edited, or a year before the tier) has ordinary tiers only. */
export function irmaaTopTierIndex(
  row: string,
  tiers: readonly IrmaaBracket[],
): number {
  const last = tiers.length - 1;
  const b = tiers[last];
  if (b === undefined) return -1;
  const floor = IRMAA_TOP_TIER_FLOOR[row];
  const top = b.topTier ?? (floor !== undefined && b.magiThreshold >= floor);
  return top ? last : -1;
}

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
): { tiers: IrmaaBracket[]; top: number } {
  const row = filingRules(filingStatus).jointRow;
  const b = brackets[row];
  if (!b || b.length === 0)
    throw new Error(`No IRMAA brackets for filing status ${filingStatus}`);
  return { tiers: b, top: irmaaTopTierIndex(row, b) };
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
  const { tiers, top } = bracketsFor(brackets, filingStatus);
  let surcharge = 0;
  tiers.forEach((b, i) => {
    if (reachesTier(magi, b, i === top)) surcharge = b.annualSurcharge;
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
 * the top tier's less a cent; null in the last tier.
 *
 * @param brackets The year's IRMAA brackets (`irmaa_brackets`, resolved).
 */
export function getNextIrmaaCliff(
  magi: number,
  filingStatus: ReturnFilingStatus,
  brackets: IrmaaBracketTable,
): number | null {
  const { tiers, top } = bracketsFor(brackets, filingStatus);
  for (const [i, b] of tiers.entries()) {
    if (!reachesTier(magi, b, i === top))
      return i === top ? roundToCents(b.magiThreshold - 0.01) : b.magiThreshold;
  }
  return null; // in the last tier
}
