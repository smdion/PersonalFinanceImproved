"use client";

/**
 * Budget column mutations (add, remove, rename, months). updateColumnMonths
 * also invalidates listProfiles for the sidebar's weighted annual total.
 */

import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useBudgetColumnMutations() {
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
