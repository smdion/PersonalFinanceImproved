"use client";

/**
 * YNAB / API-sync mutations for the budget page.
 *
 * Extracted from `src/app/(dashboard)/budget/page.tsx` during the
 * v0.5.2 file-split refactor. Pure relocation — no behavior changes.
 *
 * Both mutations busts the computeActiveSummary cache on success since
 * a pull rewrites local budgeted amounts and a push sends the current
 * amounts upstream (no local state change needed for a push, but
 * invalidation ensures any YNAB actuals refreshed upstream are
 * re-fetched on the next load).
 */

import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useSyncMutations() {
  const { invalidateSummary } = useInvalidateBudget();

  const syncFromApi = trpc.budget.syncBudgetFromApi.useMutation({
    onSuccess: invalidateSummary,
  });
  const syncToApi = trpc.budget.syncBudgetToApi.useMutation({
    onSuccess: invalidateSummary,
  });

  return { syncFromApi, syncToApi };
}

export type SyncMutations = ReturnType<typeof useSyncMutations>;
