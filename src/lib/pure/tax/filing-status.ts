/**
 * Filing status, one chain for every reader:
 * - THIS year's return: the household setting (SK_TAX_FILING_STATUS), else
 *   the active Retirement Profile's, else a W-4 (the primary person's
 *   first) — server/services/tax/filing-status.ts resolves it. The household
 *   tax, the Roth IRA check and the IRS-limit caps read it.
 * - Retirement years: the active Retirement Profile's, or "Auto" (null) —
 *   this year's.
 * - Nothing known at all: FILING_STATUS_IF_UNKNOWN, and Ledgr asks
 *   (a recommendation) — never a silent guess.
 */
import {
  parseReturnFilingStatus,
  type ReturnFilingStatus,
} from "@/lib/config/filing-status";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";

/** Where this year's filing status came from — shown beside it. */
export type FilingStatusSource = "household" | "retirementProfile" | "w4";

export function taxFilingStatusSetting(
  appSettings: readonly { key: string; value: unknown }[],
): ReturnFilingStatus | null {
  return parseReturnFilingStatus(
    appSettings.find((s) => s.key === SK_TAX_FILING_STATUS)?.value,
  );
}

/** Used only when nothing says what the household files as — Single's
 *  brackets tax the most, so a projection is never flattered by a guess;
 *  the household is asked to set it. */
export const FILING_STATUS_IF_UNKNOWN: ReturnFilingStatus = "Single";

/** Retirement years' filing status: the profile's, else ("Auto") this
 *  year's, else the cautious fallback. */
export function retirementFilingStatus(
  profileStatus: ReturnFilingStatus | null | undefined,
  thisYear: ReturnFilingStatus | null,
): ReturnFilingStatus {
  return profileStatus ?? thisYear ?? FILING_STATUS_IF_UNKNOWN;
}

/** A Retirement Profile's stored status, null meaning Auto. The column has
 *  no CHECK and a restore copies rows as they are, so any other value stops
 *  the projection rather than leaving it without withholding brackets. */
export function storedProfileFilingStatus(
  stored: string | null,
): ReturnFilingStatus | null {
  if (stored === null) return null;
  const status = parseReturnFilingStatus(stored);
  if (!status)
    throw new Error(
      `The Retirement Profile's filing status "${stored}" isn't one Ledgr knows (MFJ, Single, HOH).`,
    );
  return status;
}
