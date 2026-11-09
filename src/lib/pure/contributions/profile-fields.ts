/** Accounts a profile leaves without a value, and why one resolves so. */

import {
  type ContribResolutionStatus,
  resolveContribFieldDisplayState,
} from "@/lib/pure/household/profiles";

/**
 * Which of these accounts have no active value set under the given
 * profile's active fields — the "incomplete profile" surface for the UI.
 * Not a blocker: an incomplete profile still works everywhere (those
 * accounts are simply excluded from calculations by applyContribActiveFields),
 * this is purely for surfacing the gap so it's never a silent one.
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
 * Classify why a linked contribution account resolves the way it does for
 * one (profile, column) pair — reusing resolveContributionFieldDisplayState so
 * this can't drift from the Compare view/Profile Manager's own "why is this
 * $0" logic (RULES.md Rule 6: those two already had to be de-duplicated
 * once). Checked in this order because each check can only be meaningful
 * once the earlier ones have passed: an account absent from the global
 * active fetch has no per-profile active fields to look at; a profile with
 * no value for it was never a candidate for the sandbox layer to disable.
 */
export function classifyContribResolution(
  accountId: number,
  rawContribIds: Set<number>,
  profileActiveFields: Record<string, Record<string, unknown>>,
  activeContribIds: Set<number>,
  incompleteIds: Set<number>,
): ContribResolutionStatus {
  if (!rawContribIds.has(accountId)) return "account_unavailable";
  const { hasValue, isDisabled } = resolveContribFieldDisplayState(
    profileActiveFields[String(accountId)] ?? null,
  );
  if (!hasValue) return "not_in_profile";
  if (isDisabled) return "inactive_in_profile";
  if (!activeContribIds.has(accountId)) return "inactive_in_sandbox";
  if (incompleteIds.has(accountId)) return "no_pay_period";
  return "ok";
}
