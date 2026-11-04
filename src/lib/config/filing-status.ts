// Filing status: the status the tax return files as, and the box ticked on
// a W-4 (Form W-4 Step 1(c), a withholding choice). Two concepts that
// share their three spellings today.
import { z } from "zod/v4";

export const RETURN_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type ReturnFilingStatus = (typeof RETURN_FILING_STATUS_VALUES)[number];

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number];
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);

export type FilingStatusRules = {
  /** People on the return: one, or both spouses on a joint return. */
  readonly peopleOnReturn: 1 | 2;
  /** Position in every list of statuses (tax tables, editors). */
  readonly order: number;
};

/** One row per return status. */
export const FILING_STATUS_RULES = {
  MFJ: { peopleOnReturn: 2, order: 0 },
  Single: { peopleOnReturn: 1, order: 1 },
  HOH: { peopleOnReturn: 1, order: 2 },
} as const satisfies Record<ReturnFilingStatus, FilingStatusRules>;

/** Every return status, in `order`: each per-status tax table has all. */
export const FILING_STATUS_ORDER: readonly ReturnFilingStatus[] = [
  ...RETURN_FILING_STATUS_VALUES,
].sort((a, b) => FILING_STATUS_RULES[a].order - FILING_STATUS_RULES[b].order);

/** A stored or sent value as a return status; null when it isn't one. */
export function parseReturnFilingStatus(
  value: unknown,
): ReturnFilingStatus | null {
  return RETURN_FILING_STATUS_VALUES.find((s) => s === value) ?? null;
}
