/**
 * Filing status, one chain for every reader:
 * - THIS year's return: the household setting (SK_TAX_FILING_STATUS), else
 *   the active Retirement Profile's, else a W-4 (the primary person's
 *   first) — server/helpers/filing-status.ts resolves it. The household
 *   tax, the Roth IRA check and the IRS-limit caps read it.
 * - Retirement years: the active Retirement Profile's, or "Auto" (null) —
 *   this year's.
 * - Nothing known at all: FILING_STATUS_IF_UNKNOWN, and Ledgr asks
 *   (a recommendation) — never a silent guess.
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

/** Used only when nothing says what the household files as — Single's
 *  brackets tax the most, so a projection is never flattered by a guess;
 *  the household is asked to set it. */
export const FILING_STATUS_IF_UNKNOWN: W4FilingStatus = "Single";

/** Retirement years' filing status: the profile's, else ("Auto") this
 *  year's, else the cautious fallback. */
export function retirementFilingStatus(
  profileStatus: W4FilingStatus | null | undefined,
  thisYear: W4FilingStatus | null,
): W4FilingStatus {
  return profileStatus ?? thisYear ?? FILING_STATUS_IF_UNKNOWN;
}
