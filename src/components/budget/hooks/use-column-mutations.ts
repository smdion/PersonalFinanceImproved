"use client";

/**
 * Column-level mutations for the budget page: add, remove, rename,
 * update months, update per-column contribution profile ids.
 *
 * Extracted from `src/app/(dashboard)/budget/page.tsx` during the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * All are simple-invalidate; updateColumnMonths and
 * updateColumnContributionProfileIds additionally invalidate
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
  const updateColumnContribProfiles =
    trpc.budget.updateColumnContributionProfileIds.useMutation({
      onSuccess: invalidateSummaryAndProfiles,
    });

  return {
    addColumn,
    removeColumn,
    renameColumn,
    updateColumnMonths,
    updateColumnContribProfiles,
  };
}

export type ColumnMutations = ReturnType<typeof useColumnMutations>;
