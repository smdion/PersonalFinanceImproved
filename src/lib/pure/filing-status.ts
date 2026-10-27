/**
 * The household's filing status for THIS year's return — the household
 * setting (SK_TAX_FILING_STATUS). This year's household tax, Roth IRA
 * check and IRS-limit caps read it; retirement years keep the active
 * Retirement Profile's status. Unset (or not a status Ledgr models): null,
 * and callers fall back to the profile's, then a W-4.
 */
import {
  W4_FILING_STATUS_VALUES,
  type W4FilingStatus,
} from "@/lib/config/enum-values";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";

/** Where this year's filing status came from — shown beside it. */
export type FilingStatusSource = "household" | "retirementProfile" | "w4";

export function taxFilingStatusSetting(
  appSettings: readonly { key: string; value: unknown }[],
): W4FilingStatus | null {
  const v = appSettings.find((s) => s.key === SK_TAX_FILING_STATUS)?.value;
  return (W4_FILING_STATUS_VALUES as readonly unknown[]).includes(v)
    ? (v as W4FilingStatus)
    : null;
}
