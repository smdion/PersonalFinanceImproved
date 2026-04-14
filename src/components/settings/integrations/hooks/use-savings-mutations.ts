"use client";

/**
 * Mutations for the sinking-fund matching section of the integrations
 * preview panel. Covers linking/unlinking savings goals to API categories,
 * rename reconciliation, and linking the emergency-fund reimbursement
 * category.
 *
 * Isolated into its own hook so that a savings mutation's pending flip
 * does not cause re-renders in the budget/contrib/portfolio sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useSavingsMutations() {
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

  return {
    linkSavings,
    unlinkSavings,
    renameSavingsToApi,
    renameSavingsApiName,
    linkReimbursement,
    invalidate,
  };
}

export type SavingsMutations = ReturnType<typeof useSavingsMutations>;
