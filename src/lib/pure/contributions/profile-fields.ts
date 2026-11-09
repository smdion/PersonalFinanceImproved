/** Accounts a profile leaves without a value, and why one resolves so. */

import {
  type ContribResolutionStatus,
  resolveContributionFieldDisplayState,
} from "@/lib/pure/household/profiles";

/**
 * Accounts with no active value under the profile's active fields, surfaced as an incomplete
 * profile in the UI; not a blocker (applyContribActiveFields leaves them out).
 */
export function getIncompleteContribAccountIds(
  rows: { id: number }[],
  accountActiveFields: Record<string, Record<string, unknown>>,
): number[] {
  return rows
    .filter(
      (row) =>
        accountActiveFields[String(row.id)]?.contributionValue === undefined,
    )
    .map((row) => row.id);
}

/**
 * Why a linked contribution account resolves as it does for one (profile, column), via
 * resolveContributionFieldDisplayState like the Compare view. Checks run in order: absent
 * from the active fetch, then no value in the profile, then disabled by the sandbox.
 */
export function classifyContributionResolution(
  accountId: number,
  rawContributionIds: Set<number>,
  profileActiveFields: Record<string, Record<string, unknown>>,
  activeContributionIds: Set<number>,
  incompleteIds: Set<number>,
): ContribResolutionStatus {
  if (!rawContributionIds.has(accountId)) return "account_unavailable";
  const { hasValue, isDisabled } = resolveContributionFieldDisplayState(
    profileActiveFields[String(accountId)] ?? null,
  );
  if (!hasValue) return "not_in_profile";
  if (isDisabled) return "inactive_in_profile";
  if (!activeContributionIds.has(accountId)) return "inactive_in_sandbox";
  if (incompleteIds.has(accountId)) return "no_pay_period";
  return "ok";
}
