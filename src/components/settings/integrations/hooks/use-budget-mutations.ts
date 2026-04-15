"use client";

/**
 * Mutations for the budget-category-matching section of the integrations
 * preview panel. Covers linking/unlinking budget items to API categories,
 * creating new items from unmatched API categories, skip/unskip API
 * categories, rename reconciliation, group moves, and sync-direction
 * toggles.
 *
 * Isolated into its own hook so that a budget mutation's pending flip does
 * not cause re-renders in the savings/contrib/portfolio sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useBudgetMutations() {
  const invalidate = useInvalidatePreview();

  const linkBudget = trpc.budget.linkToApi.useMutation({
    onSuccess: invalidate,
  });
  const unlinkBudget = trpc.budget.unlinkFromApi.useMutation({
    onSuccess: invalidate,
  });
  const createItem = trpc.budget.createItem.useMutation({
    onSuccess: invalidate,
  });
  const skipCategory = trpc.sync.skipCategory.useMutation({
    onSuccess: invalidate,
  });
  const unskipCategory = trpc.sync.unskipCategory.useMutation({
    onSuccess: invalidate,
  });
  const renameBudgetToApi = trpc.sync.renameBudgetItemToApi.useMutation({
    onSuccess: invalidate,
  });
  const renameBudgetApiName = trpc.sync.renameBudgetItemApiName.useMutation({
    onSuccess: invalidate,
  });
  const moveBudgetToApiGroup = trpc.sync.moveBudgetItemToApiGroup.useMutation({
    onSuccess: invalidate,
  });
  const setBudgetSyncDir = trpc.budget.setSyncDirection.useMutation({
    onSuccess: invalidate,
  });

  return {
    mutations: {
      linkBudget,
      unlinkBudget,
      createItem,
      skipCategory,
      unskipCategory,
      renameBudgetToApi,
      renameBudgetApiName,
      moveBudgetToApiGroup,
      setBudgetSyncDir,
    },
    invalidate,
  };
}

export type BudgetMutations = ReturnType<
  typeof useBudgetMutations
>["mutations"];
