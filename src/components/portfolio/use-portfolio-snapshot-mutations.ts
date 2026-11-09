"use client";

/**
 * Snapshot-level mutations for the Portfolio page, and the one "a snapshot changed"
 * invalidation set (`invalidateSnapshotQueries`) every path uses.
 */
import { trpc } from "@/lib/trpc";

export function usePortfolioSnapshotMutations() {
  const utils = trpc.useUtils();

  const invalidateSnapshotQueries = () => {
    utils.networth.computeSummary.invalidate();
    utils.networth.listHistory.invalidate();
    utils.networth.listSnapshots.invalidate();
    utils.networth.portfolioSnapshots.getLatest.invalidate();
  };

  const deleteSnapshot = trpc.networth.portfolioSnapshots.delete.useMutation({
    onSuccess: invalidateSnapshotQueries,
  });

  const resyncPush = trpc.sync.resyncPortfolioPush.useMutation();

  /** Edit one account's balance on the latest snapshot (non-finalized year only;
   *  the server rejects otherwise). The server re-derives that year's performance
   *  and resyncs to the budget API (`apiSyncResult`). */
  const updateAccountBalance =
    trpc.networth.portfolioSnapshots.updateAccount.useMutation({
      onSuccess: invalidateSnapshotQueries,
    });

  return {
    deleteSnapshot,
    resyncPush,
    updateAccountBalance,
    invalidateSnapshotQueries,
  };
}
