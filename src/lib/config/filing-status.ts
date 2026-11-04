// Filing status: the status the tax return files as, and the box ticked on
// a W-4 (Form W-4 Step 1(c), a withholding choice). Two concepts that
// share their three spellings today, so each type carries a marker.
import { z } from "zod/v4";

export const RETURN_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
/** The spelling both statuses share: per-status tables are keyed by it. */
export type FilingStatusKey = (typeof RETURN_FILING_STATUS_VALUES)[number];
/** The marker is optional, so a literal is either status, but a value
 *  typed W-4 is not a return status: w4StandInForReturn converts one. */
export type ReturnFilingStatus = FilingStatusKey & {
  readonly __filing?: "return";
};
export const returnFilingStatusSchema = z.enum(RETURN_FILING_STATUS_VALUES);

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number] & {
  readonly __filing?: "w4";
};
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);

export type FilingStatusRules = {
  /** People on the return: one, or both spouses on a joint return. */
  readonly peopleOnReturn: 1 | 2;
  /** Position in every list of statuses (tax tables, editors). */
  readonly order: number;
};

/** One row per return status. */
export const FILING_STATUS_RULES: Readonly<
  Record<FilingStatusKey, FilingStatusRules>
> = {
  MFJ: { peopleOnReturn: 2, order: 0 },
  Single: { peopleOnReturn: 1, order: 1 },
  HOH: { peopleOnReturn: 1, order: 2 },
};

/** Every return status, in `order`: each per-status tax table has all. */
export const FILING_STATUS_ORDER: readonly ReturnFilingStatus[] = [
  ...RETURN_FILING_STATUS_VALUES,
].sort(
  (a, b) =>
    filingTable(FILING_STATUS_RULES, a).order -
    filingTable(FILING_STATUS_RULES, b).order,
);

/** A stored or sent value as a return status; null when it isn't one. */
export function parseReturnFilingStatus(
  value: unknown,
): ReturnFilingStatus | null {
  return RETURN_FILING_STATUS_VALUES.find((s) => s === value) ?? null;
}

/** A per-status table's entry for a status, either kind. */
export function filingTable<V>(
  table: Readonly<Record<FilingStatusKey, V>>,
  status: ReturnFilingStatus | W4FilingStatus,
): V {
  const key: FilingStatusKey = status;
  return table[key];
}
