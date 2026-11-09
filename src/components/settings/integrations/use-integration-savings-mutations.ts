"use client";

/**
 * Sinking-fund matching mutations (link/unlink goals, rename, emergency-fund reimbursement
 * category). A separate hook so a pending flip doesn't re-render other sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useIntegrationSavingsMutations() {
  const invalidate = useInvalidatePreview();

  const linkSavings = trpc.savings.linkGoalToApi.useMutation({
    onSuccess: invalidate,
  });
  const unlinkSavings = trpc.savings.unlinkGoalFromApi.useMutation({
    onSuccess: invalidate,
  });
  const renameSavingsToApi = trpc.sync.renameSavingsGoalToApi.useMutation({
    onSuccess: invalidate,
  });
  const renameSavingsApiName = trpc.sync.renameSavingsGoalApiName.useMutation({
    onSuccess: invalidate,
  });
  const linkReimbursement = trpc.savings.linkReimbursementCategory.useMutation({
    onSuccess: invalidate,
  });
  const createGoal = trpc.savings.savingsGoals.create.useMutation({
    onSuccess: invalidate,
  });

  return {
    linkSavings,
    unlinkSavings,
    renameSavingsToApi,
    renameSavingsApiName,
    linkReimbursement,
    createGoal,
  };
}

export type IntegrationSavingsMutations = ReturnType<
  typeof useIntegrationSavingsMutations
>;
