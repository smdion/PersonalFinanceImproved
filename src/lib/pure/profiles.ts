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
 */
export function canDeleteContribProfile(
  profile: { isDefault: boolean },
  activeProfileId: number | null,
  profileId: number,
): DeletionCheck {
  if (profile.isDefault)
    return {
      allowed: false,
      reason: "Cannot delete the default (Live) profile",
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
};

/**
 * Find the active job for a person. Active = no endDate.
 * Centralizes the duplicated `!j.endDate` pattern across routers.
 */
export function findActiveJob<T extends JobLike>(
  jobs: T[],
  personId: number,
): T | undefined {
  return jobs.find((j) => j.personId === personId && !j.endDate);
}

/**
 * Filter to only active jobs (no endDate). For use when personId filtering isn't needed.
 */
export function filterActiveJobs<T extends { endDate: string | null }>(
  jobs: T[],
): T[] {
  return jobs.filter((j) => !j.endDate);
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
