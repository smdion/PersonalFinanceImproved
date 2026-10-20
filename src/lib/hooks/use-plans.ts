"use client";

import { useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  PLAN_PROFILE_COLUMN,
  findPlanWithProfiles,
  planMatchesActive,
  planProfileIds,
  type PlanProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";
import { SK_LAST_APPLIED_PLAN_ID } from "@/lib/constants/settings-keys";
import { useActiveContribProfile } from "./use-active-contrib-profile";
import { useActiveSalaryProfile } from "./use-active-salary-profile";
import { useActiveRetirementProfile } from "./use-active-retirement-profile";
import { useBudgetProfilesList } from "./use-budget-profiles-list";

/** Every saved Plan (a named set of profiles). */
export function usePlanList() {
  const { data: plans = [] } = trpc.settings.scenarios.list.useQuery(
    undefined,
    { staleTime: 30_000 },
  );
  return plans;
}

/** Names of the Plans that use a profile — to explain why it can't be deleted. */
export function usePlanNamesUsing(): (
  kind: PlanProfileKind,
  profileId: number,
) => string[] {
  const plans = usePlanList();
  return useCallback(
    (kind, profileId) =>
      plans
        .filter((p) => p[PLAN_PROFILE_COLUMN[kind]] === profileId)
        .map((p) => p.name),
    [plans],
  );
}

/**
 * The active profile of each kind, which Plan (if any) they match, and how
 * to apply a Plan. Applying writes the Plan's profiles as the active ones
 * for the whole household, then refreshes every query.
 */
export function usePlans() {
  const plans = usePlanList();
  const utils = trpc.useUtils();
  const [contribution] = useActiveContribProfile();
  const [salary] = useActiveSalaryProfile();
  const [retirement] = useActiveRetirementProfile();
  const { data: budgetProfiles } = useBudgetProfilesList();
  const budget = budgetProfiles?.find((p) => p.isActive)?.id ?? null;
  const { data: settings } = trpc.settings.appSettings.list.useQuery();
  const lastAppliedId = settings?.find(
    (s) => s.key === SK_LAST_APPLIED_PLAN_ID,
  )?.value;

  const activeIds: PlanProfileIds = useMemo(
    () => ({ salary, contribution, budget, retirement }),
    [salary, contribution, budget, retirement],
  );

  const lastAppliedPlan = plans.find((p) => p.id === lastAppliedId) ?? null;
  // The last applied Plan wins a tie (an older Plan that leaves a kind empty
  // can match the same set).
  const matching = plans.filter((p) =>
    planMatchesActive(planProfileIds(p), activeIds),
  );
  const planInUse =
    (lastAppliedPlan && matching.includes(lastAppliedPlan)
      ? lastAppliedPlan
      : matching[0]) ?? null;
  const sameAsActive = findPlanWithProfiles(plans, activeIds) ?? null;

  const apply = trpc.settings.scenarios.activate.useMutation({
    // Applying changes every kind of active profile at once, so every
    // profile-dependent query is stale — one refresh of all of them.
    onSuccess: () => utils.invalidate(),
  });

  return {
    plans,
    activeIds,
    /** The Plan whose profiles are the active ones, if any. */
    planInUse,
    /** The Plan last applied — offered as "Update ‹Plan›" once it no longer matches. */
    lastAppliedPlan,
    /** A Plan holding exactly the active set (all four), if one exists. */
    sameAsActive,
    apply,
  };
}
