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
 * The four optimistic mutations each have their own ~25 lines of
 * onMutate/onError/onSettled boilerplate. Attempting to DRY them via a
 * shared `createOptimisticOptions` helper was tried but the context
 * type returned from onMutate does not flow through TRPC's
 * UseMutationOptions generic cleanly when spread from a helper, so the
 * safer choice is to keep each optimistic block inline.
 *
 * `selectedColumn` is read through a ref so the mutations never
 * re-bind when the active column changes (matching the original inline
 * closure's live-read semantics).
 */

import type { MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

type UseItemMutationsOpts = {
  /** Live-read of the selected column. Kept as a ref so the mutations
   *  don't need to re-bind on every column change. */
  selectedColumnRef: MutableRefObject<number>;
};

export function useItemMutations({ selectedColumnRef }: UseItemMutationsOpts) {
  const utils = trpc.useUtils();
  const { invalidateSummary, invalidateSummaryAndSavings } =
    useInvalidateBudget();

  // --- Optimistic mutations ---

  const updateCell = trpc.budget.updateItemAmount.useMutation({
    onMutate: async (variables) => {
      await utils.budget.computeActiveSummary.cancel();
      const queryInput = { selectedColumn: selectedColumnRef.current };
      const previous = utils.budget.computeActiveSummary.getData(queryInput);
      if (previous && "rawItems" in previous) {
        utils.budget.computeActiveSummary.setData(queryInput, {
          ...previous,
          rawItems: previous.rawItems.map(
            (item: (typeof previous.rawItems)[number]) => {
              if (item.id !== variables.id) return item;
              const newAmounts = [...item.amounts];
              newAmounts[variables.colIndex] = variables.amount;
              return { ...item, amounts: newAmounts };
            },
          ),
        });
      }
      return { previous, queryInput };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.computeActiveSummary.setData(
          context.queryInput,
          context.previous,
        );
      }
    },
    onSettled: () => utils.budget.computeActiveSummary.invalidate(),
  });

  const deleteItem = trpc.budget.deleteItem.useMutation({
    onMutate: async (variables) => {
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
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.computeActiveSummary.setData(
          context.queryInput,
          context.previous,
        );
      }
    },
    onSettled: () => utils.budget.computeActiveSummary.invalidate(),
  });

  const updateItemEssential = trpc.budget.updateItemEssential.useMutation({
    onMutate: async (variables) => {
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
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.computeActiveSummary.setData(
          context.queryInput,
          context.previous,
        );
      }
    },
    onSettled: () => utils.budget.computeActiveSummary.invalidate(),
  });

  const updateCategoryEssential =
    trpc.budget.updateCategoryEssential.useMutation({
      onMutate: async (variables) => {
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
      onError: (_err, _variables, context) => {
        if (context?.previous) {
          utils.budget.computeActiveSummary.setData(
            context.queryInput,
            context.previous,
          );
        }
      },
      onSettled: () => utils.budget.computeActiveSummary.invalidate(),
    });

  // --- Simple-invalidate mutations ---

  const updateBatch = trpc.budget.updateItemAmounts.useMutation({
    onSuccess: invalidateSummary,
  });
  const moveItem = trpc.budget.moveItem.useMutation({
    onSuccess: invalidateSummary,
  });
  const createItem = trpc.budget.createItem.useMutation({
    onSuccess: invalidateSummary,
  });
  const convertToGoal = trpc.savings.convertBudgetItemToGoal.useMutation({
    onSuccess: invalidateSummaryAndSavings,
  });

  return {
    updateCell,
    deleteItem,
    updateItemEssential,
    updateCategoryEssential,
    updateBatch,
    moveItem,
    createItem,
    convertToGoal,
  };
}

export type ItemMutations = ReturnType<typeof useItemMutations>;
