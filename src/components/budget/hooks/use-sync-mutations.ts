"use client";

/**
 * YNAB / API-sync mutations for the budget page.
 *
 * Both mutations bust the computeActiveSummary cache on success since
 * a pull rewrites local budgeted amounts and a push sends the current
 * amounts upstream (no local state change needed for a push, but
 * invalidation ensures any YNAB actuals refreshed upstream are
 * re-fetched on the next load). A failed push busts it too.
 */

import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import {
  formatSyncResultToast,
  budgetApiServiceLabel,
} from "@/lib/utils/format";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useSyncMutations() {
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
