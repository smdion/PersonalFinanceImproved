"use client";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useBudgetProfilesList } from "./use-budget-profiles-list";

/**
 * The shared input for every procedure that reads buildYearEndHistory: the
 * effective Budget Profile. Call this instead of re-deriving it per page.
 */
export function useYearEndTargetingInput(): {
  budgetProfileId?: number;
} {
  const { data: budgetProfiles } = useBudgetProfilesList();
  const activeBudgetProfileId =
    budgetProfiles?.find((p) => p.isActive)?.id ?? null;
  const { profileId: effectiveBudgetProfileId } = useEffectiveProfileId(
    "budget",
    {
      validIds: budgetProfiles?.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeBudgetProfileId,
    },
  );

  return {
    ...(effectiveBudgetProfileId != null
      ? { budgetProfileId: effectiveBudgetProfileId }
      : {}),
  };
}
