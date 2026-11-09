"use client";

/**
 * Budget-category-matching mutations (link/unlink, create from API category, skip, rename, group
 * moves, sync direction). A separate hook so a pending flip doesn't re-render other sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useIntegrationBudgetMutations() {
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
    linkBudget,
    unlinkBudget,
    createItem,
    skipCategory,
    unskipCategory,
    renameBudgetToApi,
    renameBudgetApiName,
    moveBudgetToApiGroup,
    setBudgetSyncDir,
  };
}
