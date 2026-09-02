// Social Security taxation — IRS provisional-income formula (IRC §86).
//
// Enacted 1993 (OBRA '93 added the 85% tier); the $25k/$32k/$34k/$44k
// thresholds and the 50%/85% inclusion rates have never been indexed to
// inflation, which is why an increasing share of retirees pay tax on SS
// over time (bracket creep by design, not oversight — see IRC §86(c)).
//
// R43 (C9): moved out of engine/tax-estimation.ts into a config module so
// the "no {MFJ|Single|HOH} object literal outside src/lib/config/" lint
// guard (tests/lint/violations.test.ts) covers it, and so it has the same
// home every other tax figure in the app has.

import type { FilingStatusType } from "../calculators/types";

/** Provisional-income thresholds by filing status, in dollars. */
export type SsTaxThresholds = { tier1: number; tier2: number };

/** SS taxation thresholds by filing status (unchanged since 1993). */
export const SS_TAX_THRESHOLDS: Record<FilingStatusType, SsTaxThresholds> = {
  MFJ: { tier1: 32000, tier2: 44000 },
  Single: { tier1: 25000, tier2: 34000 },
  HOH: { tier1: 25000, tier2: 34000 }, // Same as Single
};

/** Fraction of SS income taxable in the tier1-to-tier2 zone. */
export const SS_TAX_TIER1_INCLUSION_RATE = 0.5;
/** Fraction of SS income taxable above tier2. */
export const SS_TAX_TIER2_INCLUSION_RATE = 0.85;
