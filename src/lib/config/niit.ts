// Net Investment Income Tax (IRC §1411): 3.8% of the LESSER of net investment income (gains,
// dividends, interest, rent) or MAGI over a non-indexed threshold. Wages, SS and IRA/401k
// distributions aren't investment income, but Roth conversions raise MAGI.

import {
  survivorTable,
  type FilingStatusKey,
  type ReturnFilingStatus,
} from "./filing-status";

/** NIIT rate — fixed at 3.8% since enactment (2013). */
export const NIIT_RATE = 0.038;

/** MAGI thresholds by filing status — not indexed to inflation (IRC §1411(b)). */
export const NIIT_THRESHOLDS: Record<FilingStatusKey, number> = {
  MFJ: 250000,
  Single: 200000,
  HOH: 200000,
};

/** A return status's NIIT MAGI threshold. */
export function niitThresholdFor(status: ReturnFilingStatus): number {
  return survivorTable(NIIT_THRESHOLDS, status);
}
