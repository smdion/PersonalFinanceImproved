"use client";

type EffectiveProfileSource = "user-selection" | "active";

type EffectiveProfileId = {
  profileId: number | null;
  source: EffectiveProfileSource;
};

type EffectiveProfileKind = "budget" | "contribution" | "salary" | "retirement";

/**
 * Which profile a page shows: its own valid local selection, else the active
 * profile (a stale selection of a deleted profile falls through).
 */
export function useEffectiveProfileId(
  _kind: EffectiveProfileKind,
  options: {
    /** Ids of profiles that currently exist, to detect a stale selection. */
    validIds: Set<number> | number[] | undefined;
    /** The page's own local selection tier, if any. */
    localSelection?: number | null;
    /** The active profile id — budget's isActive row, or the active-profile setting. */
    activeProfileId: number | null;
  },
): EffectiveProfileId {
  const { validIds, localSelection, activeProfileId } = options;
  const validSet = validIds instanceof Set ? validIds : new Set(validIds ?? []);

  if (localSelection != null && (!validIds || validSet.has(localSelection))) {
    return { profileId: localSelection, source: "user-selection" };
  }
  return { profileId: activeProfileId, source: "active" };
}
