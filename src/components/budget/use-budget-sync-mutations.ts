"use client";

/**
 * YNAB/API sync mutations. Pull and push (even a failed push) invalidate
 * computeActiveSummary so local amounts and actuals refetch.
 */

import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { formatSyncResultToast } from "@/components/ui/sync-result-toast";
import { budgetApiServiceLabel } from "@/lib/config/display-labels";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useBudgetSyncMutations() {
  const { invalidateSummary } = useInvalidateBudget();
  const { data: activeBudgetApi } = trpc.sync.getActiveBudgetApi.useQuery();

  const syncFromApi = trpc.budget.syncBudgetFromApi.useMutation({
    onSuccess: (data) => {
      invalidateSummary();
      toast.success(
        formatSyncResultToast(
          data.updated,
          "pull",
          budgetApiServiceLabel(activeBudgetApi),
        ),
      );
    },
  });
  const syncToApi = trpc.budget.syncBudgetToApi.useMutation({
    // A push can stop partway; reload so the page shows what was written.
    // The global toast says what happened.
    onError: () => invalidateSummary(),
    onSuccess: (data) => {
      invalidateSummary();
      toast.success(
        formatSyncResultToast(
          data.pushed,
          "push",
          budgetApiServiceLabel(data.service),
          data.skippedUnsupported,
          0,
          undefined,
          // Same note-based-template caveat as savings' push — see
          // formatSyncResultToast's requiresManualApply docblock.
          data.service === "actual",
        ),
      );
    },
  });

  return { syncFromApi, syncToApi };
}
