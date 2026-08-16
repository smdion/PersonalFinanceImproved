"use client";

import { trpc } from "@/lib/trpc";
import { useSalaryOverrides } from "./use-salary-overrides";
import { useEffectiveProfileId } from "./use-effective-profile-id";

/**
 * The shared input for every procedure that reads through
 * buildYearEndHistory (networth, historical, assets) — resolves the
 * Plan-pinned Budget Profile (falling through to the globally-active one)
 * plus any active salary overrides, so net worth / historical / assets pages
 * stay in sync with what Paycheck/Budget/Savings show under the same Plan
 * instead of always reading raw global state. Single computation path: call
 * this instead of re-deriving budgetProfileId/salaryOverrides per page.
 */
export function useYearEndTargetingInput(): {
  budgetProfileId?: number;
  salaryOverrides?: { personId: number; salary: number }[];
} {
  const { data: budgetProfiles } = trpc.budget.listProfiles.useQuery();
  const activeBudgetProfileId =
    budgetProfiles?.find((p) => p.isActive)?.id ?? null;
  const { profileId: effectiveBudgetProfileId } = useEffectiveProfileId(
    "budget",
    {
      validIds: budgetProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeBudgetProfileId,
    },
  );
  const salaryOverrides = useSalaryOverrides();

  return {
    ...(effectiveBudgetProfileId != null
      ? { budgetProfileId: effectiveBudgetProfileId }
      : {}),
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
  };
}
