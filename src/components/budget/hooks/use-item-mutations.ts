"use client";

/**
 * Item-level mutations for the budget page.
 *
 * Extracted from `src/app/(dashboard)/budget/page.tsx` during the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * Covers:
 *   Simple-invalidate: updateBatch (batch amount saves), moveItem,
 *     createItem, convertToGoal.
 *   Optimistic: updateCell (updateItemAmount), deleteItem,
 *     updateItemEssential, updateCategoryEssential.
 *
 * The four optimistic mutations previously each carried their own ~25
 * lines of onMutate/onError/onSettled boilerplate inline — an earlier
 * attempt to DRY them via a shared `createOptimisticOptions` helper
 * (spreading generated options into tRPC's `useMutation`) hit a real
 * TypeScript limitation: the context type returned from onMutate didn't
 * flow through tRPC's `UseMutationOptions` generic cleanly when spread
 * from a helper. `useOptimisticMutation` (`src/lib/hooks/`) sidesteps
 * that by wrapping the mutation object from the outside instead of
 * spreading into tRPC's options, so it isn't subject to the same
 * generic-flow issue.
 *
 * `selectedColumn` is read through a ref so the mutations never
 * re-bind when the active column changes (matching the original inline
 * closure's live-read semantics).
 */

import type { MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import { useOptimisticMutation } from "@/lib/hooks/use-optimistic-mutation";
import { useInvalidateBudget } from "./use-invalidate-budget";

type UseItemMutationsOpts = {
  /** Live-read of the selected column. Kept as a ref so the mutations
   *  don't need to re-bind on every column change. */
  selectedColumnRef: MutableRefObject<number>;
};

export function useItemMutations({ selectedColumnRef }: UseItemMutationsOpts) {
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
                // Linked items display contribAmounts[col] (preferred) or
                // contribAmount, not amounts[col] — patch those instead so
                // the optimistic update is actually visible. Skip entirely
                // when this column's contribStatus isn't "ok":
                // applyContributionAccountEdit legitimately no-ops whenever
                // the account isn't fully resolvable for this column (stale
                // profile FK, unresolved fixed_per_period, sub-cent delta,
                // not active for this column's profile, etc.), so an
                // optimistic patch here would show a value the refetch
                // silently reverts, which reads as a lost edit.
                if (item.contributionAccountId) {
                  const status = item.contribStatus?.[variables.colIndex];
                  if (status && status !== "ok") return item;
                  const newContribAmounts = item.contribAmounts
                    ? [...item.contribAmounts]
                    : null;
                  if (newContribAmounts) {
                    newContribAmounts[variables.colIndex] = variables.amount;
                  }
                  return {
                    ...item,
                    contribAmount: variables.amount,
                    contribAmounts: newContribAmounts,
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
      showErrorToast: false,
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
      showErrorToast: false,
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
      showErrorToast: false,
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
      showErrorToast: false,
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

export type ItemMutations = ReturnType<typeof useItemMutations>;
