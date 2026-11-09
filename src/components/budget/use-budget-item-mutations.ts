"use client";

/**
 * Budget item mutations: updateBatch/moveItem/createItem/convertToGoal invalidate;
 * updateCell/deleteItem/essential toggles are optimistic via useOptimisticMutation.
 * `selectedColumn` is a ref so mutations don't re-bind on column change.
 */

import type { MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import { useOptimisticMutation } from "@/components/budget/use-optimistic-mutation";
import { useInvalidateBudget } from "./use-invalidate-budget";

type Options = {
  /** Live-read of the selected column. Kept as a ref so the mutations
   *  don't need to re-bind on every column change. */
  selectedColumnRef: MutableRefObject<number>;
};

export function useBudgetItemMutations({ selectedColumnRef }: Options) {
  const utils = trpc.useUtils();
  const { invalidateSummary, invalidateSummaryAndContributions } =
    useInvalidateBudget();

  // --- Optimistic mutations ---

  const updateCell = useOptimisticMutation(
    trpc.budget.updateItemAmount.useMutation(),
    {
      optimisticUpdate: async (variables) => {
        await utils.budget.computeActiveSummary.cancel();
        const queryInput = { selectedColumn: selectedColumnRef.current };
        const previous = utils.budget.computeActiveSummary.getData(queryInput);
        if (previous && "rawItems" in previous) {
          utils.budget.computeActiveSummary.setData(queryInput, {
            ...previous,
            rawItems: previous.rawItems.map(
              (item: (typeof previous.rawItems)[number]) => {
                if (item.id !== variables.id) return item;
                // Linked items show contribAmounts[col] or contribAmount, so
                // patch those; skip when contribStatus isn't "ok", since the
                // server no-ops then and the refetch would revert the edit.
                if (item.contributionAccountId) {
                  const status = item.contribStatus?.[variables.colIndex];
                  if (status && status !== "ok") return item;
                  const newContributionAmounts = item.contribAmounts
                    ? [...item.contribAmounts]
                    : null;
                  if (newContributionAmounts) {
                    newContributionAmounts[variables.colIndex] =
                      variables.amount;
                  }
                  return {
                    ...item,
                    contribAmount: variables.amount,
                    contribAmounts: newContributionAmounts,
                  };
                }
                const newAmounts = [...item.amounts];
                newAmounts[variables.colIndex] = variables.amount;
                return { ...item, amounts: newAmounts };
              },
            ),
          });
        }
        return { previous, queryInput };
      },
      rollback: ({ previous, queryInput }) => {
        if (previous) {
          utils.budget.computeActiveSummary.setData(queryInput, previous);
        }
      },
      onSettled: () => invalidateSummaryAndContributions(),
    },
  );

  const deleteItem = useOptimisticMutation(
    trpc.budget.deleteItem.useMutation(),
    {
      optimisticUpdate: async (variables) => {
        await utils.budget.computeActiveSummary.cancel();
        const queryInput = { selectedColumn: selectedColumnRef.current };
        const previous = utils.budget.computeActiveSummary.getData(queryInput);
        if (previous && "rawItems" in previous) {
          utils.budget.computeActiveSummary.setData(queryInput, {
            ...previous,
            rawItems: previous.rawItems.filter(
              (item: (typeof previous.rawItems)[number]) =>
                item.id !== variables.id,
            ),
          });
        }
        return { previous, queryInput };
      },
      rollback: ({ previous, queryInput }) => {
        if (previous) {
          utils.budget.computeActiveSummary.setData(queryInput, previous);
        }
      },
      onSettled: () => invalidateSummary(),
    },
  );

  const updateItemEssential = useOptimisticMutation(
    trpc.budget.updateItemEssential.useMutation(),
    {
      optimisticUpdate: async (variables) => {
        await utils.budget.computeActiveSummary.cancel();
        const queryInput = { selectedColumn: selectedColumnRef.current };
        const previous = utils.budget.computeActiveSummary.getData(queryInput);
        if (previous && "rawItems" in previous) {
          utils.budget.computeActiveSummary.setData(queryInput, {
            ...previous,
            rawItems: previous.rawItems.map(
              (item: (typeof previous.rawItems)[number]) =>
                item.id === variables.id
                  ? { ...item, isEssential: variables.isEssential }
                  : item,
            ),
          });
        }
        return { previous, queryInput };
      },
      rollback: ({ previous, queryInput }) => {
        if (previous) {
          utils.budget.computeActiveSummary.setData(queryInput, previous);
        }
      },
      onSettled: () => invalidateSummary(),
    },
  );

  const updateCategoryEssential = useOptimisticMutation(
    trpc.budget.updateCategoryEssential.useMutation(),
    {
      optimisticUpdate: async (variables) => {
        await utils.budget.computeActiveSummary.cancel();
        const queryInput = { selectedColumn: selectedColumnRef.current };
        const previous = utils.budget.computeActiveSummary.getData(queryInput);
        if (previous && "rawItems" in previous) {
          utils.budget.computeActiveSummary.setData(queryInput, {
            ...previous,
            rawItems: previous.rawItems.map(
              (item: (typeof previous.rawItems)[number]) =>
                item.category === variables.category
                  ? { ...item, isEssential: variables.isEssential }
                  : item,
            ),
          });
        }
        return { previous, queryInput };
      },
      rollback: ({ previous, queryInput }) => {
        if (previous) {
          utils.budget.computeActiveSummary.setData(queryInput, previous);
        }
      },
      onSettled: () => invalidateSummary(),
    },
  );

  // --- Simple-invalidate mutations ---

  const updateBatch = trpc.budget.updateItemAmounts.useMutation({
    onSuccess: invalidateSummaryAndContributions,
  });
  const moveItem = trpc.budget.moveItem.useMutation({
    onSuccess: invalidateSummary,
  });
  const reorderItem = trpc.budget.reorderItem.useMutation({
    onSuccess: invalidateSummary,
  });
  const reorderCategory = trpc.budget.reorderCategory.useMutation({
    onSuccess: invalidateSummary,
  });
  const createItem = trpc.budget.createItem.useMutation({
    onSuccess: invalidateSummary,
  });
  const convertToGoal = trpc.savings.convertBudgetItemToGoal.useMutation({
    onSuccess: invalidateSummary,
  });

  return {
    updateCell,
    deleteItem,
    updateItemEssential,
    updateCategoryEssential,
    updateBatch,
    moveItem,
    reorderItem,
    reorderCategory,
    createItem,
    convertToGoal,
  };
}
