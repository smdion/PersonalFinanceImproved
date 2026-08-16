"use client";

import { useScenario } from "@/lib/context/scenario-context";

export type EffectiveProfileSource =
  "plan-pin" | "user-selection" | "global-default";

export type EffectiveProfileId = {
  profileId: number | null;
  source: EffectiveProfileSource;
  isPinned: boolean;
};

/**
 * The single resolver for "which Budget/Contribution Profile is effectively
 * active right now" — every page that shows or edits profile-dependent data
 * must call this instead of re-deriving the fallback chain locally.
 *
 * Precedence: Plan pin (active Scenario's budgetProfileId/contributionProfileId)
 * → the page's own local selection (e.g. a viewing dropdown) → the globally-active
 * profile. A pin pointing at a since-deleted profile is treated as absent (falls
 * through to the next tier) rather than surfaced as an error — `validIds` is how
 * a caller reports which profile ids currently exist.
 */
export function useEffectiveProfileId(
  kind: "budget" | "contribution",
  options: {
    /** Ids of profiles that currently exist, to detect a stale/deleted pin. */
    validIds: Set<number> | number[] | undefined;
    /** The page's own local selection tier (e.g. a viewing dropdown), if any. */
    localSelection?: number | null;
    /** The globally-active profile id — budget's isActive row, or contribution's active-profile setting. */
    globalDefaultId: number | null;
  },
): EffectiveProfileId {
  const { activeScenario } = useScenario();
  const { validIds, localSelection, globalDefaultId } = options;

  const validSet = validIds instanceof Set ? validIds : new Set(validIds ?? []);

  const pinnedId =
    kind === "budget"
      ? (activeScenario?.budgetProfileId ?? null)
      : (activeScenario?.contributionProfileId ?? null);

  if (pinnedId != null && validSet.has(pinnedId)) {
    return { profileId: pinnedId, source: "plan-pin", isPinned: true };
  }

  if (localSelection != null) {
    return {
      profileId: localSelection,
      source: "user-selection",
      isPinned: false,
    };
  }

  return {
    profileId: globalDefaultId,
    source: "global-default",
    isPinned: false,
  };
}
