"use client";

import { useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  PLAN_PROFILE_COLUMN,
  PLAN_PROFILE_KIND_TITLES,
  type PlanProfileIds,
  type PlanProfileKind,
} from "@/lib/config/plans";
import {
  planChanges,
  planMatchesActive,
  planProfileIds,
} from "@/lib/pure/plans";
import { diffContribProfileSwap } from "@/lib/pure/contrib-profile-diff";
import { confirmWithDiff } from "@/components/ui/confirm-dialog";
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
  // The last applied Plan wins a tie (two Plans can hold the same set).
  const matching = plans.filter((p) =>
    planMatchesActive(planProfileIds(p), activeIds),
  );
  const planInUse =
    (lastAppliedPlan && matching.includes(lastAppliedPlan)
      ? lastAppliedPlan
      : matching[0]) ?? null;
  // Saving the set in use again would duplicate that Plan.
  const sameAsActive = planInUse;

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
    /** Same as planInUse — offered as "same profiles as ‹Plan›" when saving. */
    sameAsActive,
    apply,
  };
}

/**
 * Ask before applying a Plan — one confirm for the header and Compare
 * Plans. It lists the profiles that change and, like the Contributions
 * picker, the contribution amounts a Contribution Profile swap changes,
 * since applying is household-wide (and syncs to the budget app).
 */
export function useConfirmApplyPlan() {
  const { activeIds } = usePlans();
  const { data: budgetProfiles } = useBudgetProfilesList();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { data: retirementProfiles } =
    trpc.retirement.retirementProfiles.list.useQuery();
  const { data: compare } = trpc.contributionProfile.compareData.useQuery();
  const lists = useMemo<
    Record<PlanProfileKind, readonly { id: number; name: string }[] | undefined>
  >(
    () => ({
      salary: salaryProfiles,
      contribution: contribProfiles,
      budget: budgetProfiles,
      retirement: retirementProfiles,
    }),
    [salaryProfiles, contribProfiles, budgetProfiles, retirementProfiles],
  );

  return useCallback(
    async (plan: Parameters<typeof planProfileIds>[0] & { name: string }) => {
      const changes = planChanges(planProfileIds(plan), activeIds);
      if (changes.length === 0) return false;
      const lines = changes.map(
        ({ kind, id }) =>
          `${PLAN_PROFILE_KIND_TITLES[kind]}: ${lists[kind]?.find((p) => p.id === id)?.name ?? "—"}`,
      );
      const contribChange = changes.find((c) => c.kind === "contribution");
      if (contribChange && compare) {
        const outgoing = compare.profiles.find(
          (p) => p.id === activeIds.contribution,
        );
        const incoming = compare.profiles.find(
          (p) => p.id === contribChange.id,
        );
        if (outgoing)
          lines.push(
            ...diffContribProfileSwap(
              outgoing.accountActiveFields,
              incoming?.accountActiveFields ?? {},
              compare.accounts,
            ),
          );
      }
      return confirmWithDiff(
        `Apply Plan "${plan.name}"? This makes these the active profiles for everyone in the household (and what syncs to your budget app):`,
        lines,
        "Apply",
      );
    },
    [activeIds, lists, compare],
  );
}
