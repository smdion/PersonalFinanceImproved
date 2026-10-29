"use client";

type EffectiveProfileSource = "user-selection" | "global-default";

type EffectiveProfileId = {
  profileId: number | null;
  source: EffectiveProfileSource;
};

type EffectiveProfileKind = "budget" | "contribution" | "salary" | "retirement";

/**
 * The single resolver for "which Budget/Contribution/Salary/Retirement
 * Profile does this page show" — every page that shows or edits
 * profile-dependent data calls this instead of re-deriving the fallback
 * locally.
 *
 * Precedence: the page's own local selection (the What-If sandbox, or a
 * profile manager's "which one am I editing") → the active profile. A Plan
 * is not a tier: applying a Plan makes its profiles the active ones.
 * `validIds` is accepted so a stale local selection (a since-deleted
 * profile) falls through to the active profile instead of erroring.
 */
export function useEffectiveProfileId(
  _kind: EffectiveProfileKind,
  options: {
    /** Ids of profiles that currently exist, to detect a stale selection. */
    validIds: Set<number> | number[] | undefined;
    /** The page's own local selection tier, if any. */
    localSelection?: number | null;
    /** The active profile id — budget's isActive row, or the active-profile setting. */
    globalDefaultId: number | null;
  },
): EffectiveProfileId {
  const { validIds, localSelection, globalDefaultId } = options;
  const validSet = validIds instanceof Set ? validIds : new Set(validIds ?? []);

  if (localSelection != null && (!validIds || validSet.has(localSelection))) {
    return { profileId: localSelection, source: "user-selection" };
  }
  return { profileId: globalDefaultId, source: "global-default" };
}
