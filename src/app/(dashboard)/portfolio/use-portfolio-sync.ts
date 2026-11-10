import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { errorText } from "@/lib/utils/mutation-error";
import { budgetApiServiceLabel } from "@/lib/config/display-labels";
import { toast } from "@/lib/hooks/use-toast";
import { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";

export function usePortfolioSync(
  updateAccountBalance: ReturnType<
    typeof usePortfolioSnapshotMutations
  >["updateAccountBalance"],
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"],
) {
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const budgetApiConnected = !!syncStatus?.connected;
  const syncServiceLabel = budgetApiServiceLabel(syncStatus?.service ?? "none");

  const {
    pending: syncPendingRaw,
    markDirty: markDirtyRaw,
    clear: clearSyncPending,
  } = useSnapshotSyncPending();
  // Only a household with a live budget-API connection has anything to
  // resync — otherwise the balance edit just saves and we're done.
  const syncPending = budgetApiConnected ? syncPendingRaw : null;
  const markDirty = useCallback(
    (snapshotId: number, snapshotDate: string) => {
      if (budgetApiConnected) markDirtyRaw(snapshotId, snapshotDate);
    },
    [budgetApiConnected, markDirtyRaw],
  );

  /** Inline balance fix on the latest snapshot: saves and recomputes now; the
   *  budget-API push waits for the user (snapshot marked "not synced"), and
   *  one push covers every pending edit. */
  const handleBalanceEdit = useCallback(
    async (
      accountId: number,
      snapshotId: number,
      snapshotDate: string,
      rawAmount: string,
    ) => {
      const amount = rawAmount.replace(/[^0-9.]/g, "");
      const n = Number(amount);
      if (!amount || Number.isNaN(n) || n < 0) {
        toast.error("Enter a valid balance.");
        return;
      }
      try {
        const res = await updateAccountBalance.mutateAsync({
          id: accountId,
          amount,
        });
        markDirty(snapshotId, snapshotDate);
        if (res.amountEdited && res.performance === "year-finalized")
          toast.info(
            `Balance saved. ${snapshotDate.slice(0, 4)} is finalized in Performance, so its figures there didn't change.`,
          );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Couldn't update the balance.",
        );
      }
    },
    [updateAccountBalance, markDirty],
  );

  /** Push the pending balance edits for one snapshot to the budget API —
   *  one resync for all of them. Clears the "not synced" flag on success;
   *  keeps it (banner + badge stay) on failure. */
  const syncPendingSnapshot = useCallback(
    async (snapshotId: number) => {
      try {
        const r = await resyncPush.mutateAsync({
          snapshotId,
          confirmNonLatest: false,
        });
        clearSyncPending();
        toast.success(
          `Synced to ${syncServiceLabel} — posted ${r.posted}, cleaned ${r.cleaned}.`,
        );
      } catch (e) {
        toast.error(
          `Sync failed: ${errorText(e, "unknown error").replace(/\.$/, "")}. Your edits are saved — the "Sync to ${syncServiceLabel}" button is still there to retry.`,
          9000,
        );
      }
    },
    [resyncPush, clearSyncPending, syncServiceLabel],
  );

  return {
    budgetApiConnected,
    syncServiceLabel,
    clearSyncPending,
    syncPending,
    handleBalanceEdit,
    syncPendingSnapshot,
  };
}
