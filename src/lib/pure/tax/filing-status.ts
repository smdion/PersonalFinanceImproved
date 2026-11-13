/**
 * Filing status, one chain: this year's return = household setting, else the active Retirement
 * Profile's, else a W-4 (server/services/tax/filing-status.ts); retirement years = the profile's or
 * this year's; none known: FILING_STATUS_IF_UNKNOWN, and Ledgr asks. See lib/config/filing-status*.ts.
 */
import {
  filingRules,
  parseReturnFilingStatus,
  RETURN_FILING_STATUS_VALUES,
  type ReturnFilingStatus,
  type W4FilingStatus,
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

/** The W-4 Step 1(c) box for the household's stated status, for a new job's W-4 ("Married
 *  filing jointly or Qualifying surviving spouse" for QSS); null when none is stated. */
export function w4BoxSetting(
  appSettings: readonly { key: string; value: unknown }[],
): W4FilingStatus | null {
  const status = taxFilingStatusSetting(appSettings);
  return status ? filingRules(status).survivorRow : null;
}

/** Used only when nothing says what the household files as — Single's
 *  brackets tax the most, so a projection is never flattered by a guess;
 *  the household is asked to set it. */
export const FILING_STATUS_IF_UNKNOWN: ReturnFilingStatus = "Single";

/** Retirement years' filing status: the profile's, else ("Auto") this
 *  year's, else the cautious fallback; as the status the projection's years
 *  file as (a surviving spouse's QSS ends after two years: Single). */
export function retirementFilingStatus(
  profileStatus: ReturnFilingStatus | null | undefined,
  thisYear: ReturnFilingStatus | null,
): ReturnFilingStatus {
  return filingRules(profileStatus ?? thisYear ?? FILING_STATUS_IF_UNKNOWN)
    .projectionStatus;
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
      `The Retirement Profile's filing status "${stored}" isn't one Ledgr knows (${RETURN_FILING_STATUS_VALUES.join(", ")}).`,
    );
  return status;
}
