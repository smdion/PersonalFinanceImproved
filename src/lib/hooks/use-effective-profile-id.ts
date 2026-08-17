"use client";

import { useScenario } from "@/lib/context/scenario-context";

export type EffectiveProfileSource =
  "plan-pin" | "user-selection" | "global-default";

export type EffectiveProfileId = {
  profileId: number | null;
  source: EffectiveProfileSource;
  isPinned: boolean;
  /**
   * The active Plan's pin for this kind, validated against `validIds` — null
   * when no Plan is active, the Plan pins nothing for this axis, or the pin
   * points at a since-deleted profile.
   *
   * Callers that feed a *budget column* resolution must pass this as the
   * `planPinId` tier of resolveContributionProfileId/resolveSalaryProfileId
   * rather than passing `profileId` as the global default — collapsing the
   * Plan pin into the lowest tier is what made a column pin beat a Plan pin
   * (see that file's docblock and docs/RULES.md "Profile Pins").
   */
  planPinId: number | null;
};

/** Which `scenarios` column holds each profile kind's Plan pin. */
const PIN_FIELD_BY_KIND = {
  budget: "budgetProfileId",
  contribution: "contributionProfileId",
  salary: "salaryProfileId",
} as const;

export type EffectiveProfileKind = keyof typeof PIN_FIELD_BY_KIND;

/**
 * The single resolver for "which Budget/Contribution/Salary Profile is
 * effectively active right now" — every page that shows or edits
 * profile-dependent data must call this instead of re-deriving the fallback
 * chain locally.
 *
 * Precedence: Plan pin (the active Scenario's pin column for this kind, per
 * PIN_FIELD_BY_KIND) → the page's own local selection (e.g. a viewing
 * dropdown) → the globally-active profile. A pin pointing at a since-deleted
 * profile is treated as absent (falls through to the next tier) rather than
 * surfaced as an error — `validIds` is how a caller reports which profile ids
 * currently exist.
 */
export function useEffectiveProfileId(
  kind: EffectiveProfileKind,
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

  const rawPinnedId = activeScenario?.[PIN_FIELD_BY_KIND[kind]] ?? null;
  const planPinId =
    rawPinnedId != null && validSet.has(rawPinnedId) ? rawPinnedId : null;

  if (planPinId != null) {
    return {
      profileId: planPinId,
      source: "plan-pin",
      isPinned: true,
      planPinId,
    };
  }

  if (localSelection != null) {
    return {
      profileId: localSelection,
      source: "user-selection",
      isPinned: false,
      planPinId: null,
    };
  }

  return {
    profileId: globalDefaultId,
    source: "global-default",
    isPinned: false,
    planPinId: null,
  };
}
