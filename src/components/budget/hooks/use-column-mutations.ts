"use client";

/**
 * Column-level mutations for the budget page: add, remove, rename,
 * update months.
 *
 * All are simple-invalidate; updateColumnMonths additionally invalidates
 * listProfiles because their side effect flows into the profile list
 * sidebar's weighted-annual-total column.
 */

import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useColumnMutations() {
  const { invalidateSummary, invalidateSummaryAndProfiles } =
    useInvalidateBudget();

  const addColumn = trpc.budget.addColumn.useMutation({
    onSuccess: invalidateSummary,
  });
  const removeColumn = trpc.budget.removeColumn.useMutation({
    onSuccess: invalidateSummary,
  });
  const renameColumn = trpc.budget.renameColumn.useMutation({
    onSuccess: invalidateSummary,
  });
  const updateColumnMonths = trpc.budget.updateColumnMonths.useMutation({
    onSuccess: invalidateSummaryAndProfiles,
  });

  return {
    addColumn,
    removeColumn,
    renameColumn,
    updateColumnMonths,
  };
}

export type ColumnMutations = ReturnType<typeof useColumnMutations>;
