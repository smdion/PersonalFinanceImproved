// Social Security taxation: the IRS provisional-income formula (IRC §86). The $25k/$32k/$34k/$44k
// thresholds and 50%/85% inclusion rates are not indexed to inflation (IRC §86(c)).

import {
  jointTable,
  type FilingStatusKey,
  type ReturnFilingStatus,
} from "./filing-status";

/** Provisional-income thresholds by filing status, in dollars. */
type SsTaxThresholds = { tier1: number; tier2: number };

/** SS taxation thresholds by filing status (unchanged since 1993). */
export const SS_TAX_THRESHOLDS: Record<FilingStatusKey, SsTaxThresholds> = {
  MFJ: { tier1: 32000, tier2: 44000 },
  Single: { tier1: 25000, tier2: 34000 },
  HOH: { tier1: 25000, tier2: 34000 }, // Same as Single
};

/** Fraction of SS income taxable in the tier1-to-tier2 zone. */
export const SS_TAX_TIER1_INCLUSION_RATE = 0.5;
/** Fraction of SS income taxable above tier2. */
export const SS_TAX_TIER2_INCLUSION_RATE = 0.85;

/** A return status's SS taxation thresholds. */
export function ssTaxThresholdsFor(
  status: ReturnFilingStatus,
): SsTaxThresholds {
  return jointTable(SS_TAX_THRESHOLDS, status);
}
