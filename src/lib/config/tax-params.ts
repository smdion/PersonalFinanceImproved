/** Tax-parameter constants the tax consumers share (Roth IRA phase-out, Medicare, HDHP,
 *  filing-status sets). The resolver is lib/pure/tax/resolve-tax-params.ts. */

import type { HsaCoverageType } from "./enum-values";
import type { FilingStatusKey, ReturnFilingStatus } from "./filing-status";

/** Pub 590-A Worksheet 2-2: a reduced Roth IRA limit rounds UP to the next
 *  multiple of this, and any amount above $0 but below the floor becomes
 *  the floor (statutory, IRC 408A(c)(3) — not indexed). */
export const ROTH_IRA_REDUCED_LIMIT_ROUNDING = 10;
export const ROTH_IRA_REDUCED_LIMIT_FLOOR = 200;

/** The senior deduction's phase-out start row: joint returns have their own (IRC
 *  151(d)(5)(C)(iii)), every other return the unmarried one. */
export const SENIOR_PHASEOUT_START_KEY: Readonly<
  Record<FilingStatusKey, string>
> = {
  MFJ: "obbba_senior_deduction_phaseout_start_mfj",
  Single: "obbba_senior_deduction_phaseout_start_unmarried",
  HOH: "obbba_senior_deduction_phaseout_start_unmarried",
};

/** The yearly limit rows for a filing status (lower-cased in the key,
 *  matching `standard_deduction_<status>`). */
export function rothIraPhaseoutKeys(filingStatus: string): {
  start: string;
  end: string;
} {
  const s = filingStatus.toLowerCase();
  return {
    start: `roth_ira_phaseout_start_${s}`,
    end: `roth_ira_phaseout_end_${s}`,
  };
}

/** The Additional Medicare LIABILITY threshold row for a filing status. */
export function medicareLiabilityKey(filingStatus: string): string {
  return `fica_medicare_surtax_liability_${filingStatus.toLowerCase()}`;
}

/** A pre-tax IRA balance below this share of the person's IRA limit gets no pro-rata
 *  warning: under ~1% of a full year's conversion would be taxable. */
export const PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT = 0.01;

/** Married filing separately (and lived together): the Roth IRA phase-out
 *  is statutory and not indexed (IRC 408A(c)(3)(B)). The app has no MFS
 *  status — shown on the fixed-by-law list and the Roth IRA panel's note. */
export const ROTH_IRA_MFS_PHASEOUT = { start: 0, end: 10_000 } as const;

/** The yearly HDHP minimum-deductible row for each HSA coverage type —
 *  the default cash buffer to keep uninvested in an HSA. */
export const HDHP_MIN_DEDUCTIBLE_KEY: Record<HsaCoverageType, string> = {
  self_only: "hdhp_min_deductible_self",
  family: "hdhp_min_deductible_family",
};

/** Filing statuses where a spouse's IRA can be funded from the couple's
 *  combined compensation (spousal IRA, IRC 219(c)). */
export const SPOUSAL_IRA_FILING_STATUSES: readonly ReturnFilingStatus[] = [
  "MFJ",
];

/** Filing statuses of a married couple: if either spouse has family HSA
 *  coverage, both are treated as having it and share one family limit, each
 *  spouse's catch-up on top (IRS Pub 969). The app has no MFS status. */
export const MARRIED_FILING_STATUSES: readonly ReturnFilingStatus[] = ["MFJ"];
