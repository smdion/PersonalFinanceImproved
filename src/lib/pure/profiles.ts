/**
 * Pure business logic for profile management, active job detection, and profile linking.
 * Extracted from multiple routers — no DB or I/O dependency.
 */

// --- Profile deletion guards ---

export type DeletionCheck = { allowed: boolean; reason?: string };

/**
 * Check if a budget profile can be deleted.
 */
export function canDeleteBudgetProfile(profile: {
  isActive: boolean;
}): DeletionCheck {
  if (profile.isActive)
    return { allowed: false, reason: "Cannot delete the active profile" };
  return { allowed: true };
}

/**
 * Check if a contribution profile can be deleted.
 *
 * There is no privileged "default" profile any more — every Contribution
 * Profile is an ordinary row. What has to stay true instead is that at least
 * ONE profile always exists (the active-profile setting must always point at
 * a real row), hence the profileCount guard.
 *
 * The "pinned by a Plan" guard lives in the router, which has to name the
 * offending Plans in its message.
 */
export function canDeleteContribProfile(
  activeProfileId: number | null,
  profileId: number,
  profileCount: number,
): DeletionCheck {
  if (profileCount <= 1)
    return {
      allowed: false,
      reason: "Cannot delete the only remaining Contribution Profile",
    };
  if (activeProfileId === profileId)
    return {
      allowed: false,
      reason:
        "Cannot delete the active profile. Switch to a different profile first.",
    };
  return { allowed: true };
}

/**
 * Check if a salary profile can be deleted. Twin of
 * canDeleteContribProfile — no sentinel id, same last-one-standing rule.
 */
export function canDeleteSalaryProfile(
  activeProfileId: number | null,
  profileId: number,
  profileCount: number,
): DeletionCheck {
  if (profileCount <= 1)
    return {
      allowed: false,
      reason: "Cannot delete the only remaining Salary Profile",
    };
  if (activeProfileId === profileId)
    return {
      allowed: false,
      reason:
        "Cannot delete the active profile. Switch to a different profile first.",
    };
  return { allowed: true };
}

/**
 * Check if a retirement profile can be deleted. Twin of
 * canDeleteContribProfile/canDeleteSalaryProfile — no sentinel id, same
 * last-one-standing rule. "Pinned by a Plan" lives in the router, same as
 * the other two, which has to name the offending Plans in its message.
 */
export function canDeleteRetirementProfile(
  activeProfileId: number | null,
  profileId: number,
  profileCount: number,
): DeletionCheck {
  if (profileCount <= 1)
    return {
      allowed: false,
      reason: "Cannot delete the only remaining Retirement Profile",
    };
  if (activeProfileId === profileId)
    return {
      allowed: false,
      reason:
        "Cannot delete the active profile. Switch to a different profile first.",
    };
  return { allowed: true };
}

/**
 * Check if a column can be removed from a budget profile.
 */
export function canRemoveColumn(
  columnCount: number,
  colIndex: number,
): DeletionCheck {
  if (columnCount <= 1)
    return { allowed: false, reason: "Cannot remove the last column" };
  if (colIndex >= columnCount)
    return { allowed: false, reason: "Invalid column index" };
  return { allowed: true };
}

// --- Active job detection ---

/** Minimal job shape for active detection. */
export type JobLike = {
  personId: number;
  endDate: string | null;
  /** A speculative job is a permanent, auto-provisioned peg for Salary
   *  Profiles to pin what-if scenarios against — it never ends (endDate is
   *  always null) but must NEVER be treated as a person's real, active job. */
  isSpeculative: boolean;
};

/**
 * Find the active job for a person. Active = no endDate AND not speculative.
 * Centralizes the duplicated `!j.endDate` pattern across routers.
 */
export function findActiveJob<T extends JobLike>(
  jobs: T[],
  personId: number,
): T | undefined {
  return jobs.find(
    (j) => j.personId === personId && !j.endDate && !j.isSpeculative,
  );
}

/**
 * Filter to only active jobs (no endDate, not speculative). For use when
 * personId filtering isn't needed.
 */
export function filterActiveJobs<
  T extends { endDate: string | null; isSpeculative: boolean },
>(jobs: T[]): T[] {
  return jobs.filter((j) => !j.endDate && !j.isSpeculative);
}

// --- Profile linking ---

/** Minimal profile shape for resolution. */
export type ProfileLike = {
  id: number;
  isActive: boolean;
};

/**
 * Resolve which profile to use: linked profile if specified, otherwise the active one.
 * Centralizes the duplicated linkedProfileId fallback pattern.
 */
export function resolveLinkedProfile<T extends ProfileLike>(
  linkedProfileId: number | null | undefined,
  allProfiles: T[],
): T | undefined {
  if (linkedProfileId) {
    return allProfiles.find((p) => p.id === linkedProfileId);
  }
  return allProfiles.find((p) => p.isActive);
}

// --- Contribution account per-profile active-field resolution (concept 4) ---

/** A contribution account's raw active-field entry under one Contribution
 *  Profile — `null`/absent means the account carries no value in this
 *  profile at all (excluded, see applyContribActiveFields); `isActive:
 *  false` means it has a value but is switched off within this profile
 *  (a distinct state from having no value). */
export type ContribAccountActiveFields = {
  contributionValue?: string | number;
  contributionMethod?: string;
  isActive?: boolean;
} | null;

export type ContribFieldDisplayState = {
  /** True when this profile has a resolvable `contributionValue` for the
   *  account, including an explicit value of "0" — absence, not zero, is
   *  what excludes a row (matches getIncompleteContribAccountIds's own
   *  definition of "incomplete"). An entry can exist without this being
   *  true — e.g. a custom `displayNameActive` set on an account that was
   *  never given a value — so this deliberately checks `contributionValue`
   *  directly rather than "does an entry object exist at all," which
   *  previously let a value-less entry fall through to rendering the
   *  literal string "undefined" in the Compare matrix. */
  hasValue: boolean;
  /** True when the profile's entry explicitly turns the account off
   *  (`isActive: false`) rather than merely omitting it. */
  isDisabled: boolean;
  value: string | number | undefined;
  /** "%" for percent_of_salary, else "" — suffix for rendering `value`. */
  methodSuffix: string;
};

/**
 * Resolve a contribution account's display state from its raw per-profile
 * active-field entry — shared by the Compare view (one column per profile)
 * and the Profile Manager's read-only summary table (one row per account),
 * which independently reimplemented this identical rule before (RULES.md
 * Rule 6). Not used by the edit-form inputs, which read the same
 * `contributionValue`/`isActive` fields directly since they bind to form
 * state rather than rendering a label.
 */
export function resolveContribFieldDisplayState(
  activeFields: ContribAccountActiveFields,
): ContribFieldDisplayState {
  const hasValue = activeFields?.contributionValue !== undefined;
  const isDisabled = activeFields?.isActive === false;
  const methodSuffix =
    activeFields?.contributionMethod === "percent_of_salary" ? "%" : "";
  const value = activeFields?.contributionValue;

  return { hasValue, isDisabled, value, methodSuffix };
}

/**
 * Why a linked budget item's contribution account resolved to $0 for a
 * given column, distinguishing genuinely-zero from five different "there's
 * no real value here" causes that used to collapse into an indistinguishable
 * $0 — see classifyContribResolution (src/server/helpers/contribution.ts),
 * which is the only place that computes this.
 */
export type ContribResolutionStatus =
  | "ok"
  | "not_in_profile"
  | "inactive_in_profile"
  | "inactive_in_sandbox"
  | "no_pay_period"
  | "account_unavailable";

// --- Performance account deletion guard ---

/**
 * Check if a performance account can be deleted (no referencing performance records).
 */
export function canDeletePerformanceAccount(
  referenceCount: number,
): DeletionCheck {
  if (referenceCount > 0)
    return {
      allowed: false,
      reason: `Cannot delete: ${referenceCount} performance record(s) reference this account. Deactivate it instead.`,
    };
  return { allowed: true };
}
