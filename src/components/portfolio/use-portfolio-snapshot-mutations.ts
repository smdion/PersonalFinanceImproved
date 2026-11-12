"use client";

/**
 * Snapshot-level mutations for the Portfolio page, and the one "a snapshot changed"
 * invalidation set (`invalidateSnapshotQueries`) every path uses.
 */
import { trpc } from "@/lib/trpc";

export function usePortfolioSnapshotMutations() {
  const utils = trpc.useUtils();

  const invalidateSnapshotQueries = () => {
    utils.netWorth.computeSummary.invalidate();
    utils.netWorth.listHistory.invalidate();
    utils.netWorth.listSnapshots.invalidate();
    utils.netWorth.portfolioSnapshots.getLatest.invalidate();
  };

  const deleteSnapshot = trpc.netWorth.portfolioSnapshots.delete.useMutation({
    onSuccess: invalidateSnapshotQueries,
  });

  const resyncPush = trpc.sync.resyncPortfolioPush.useMutation();

  /** Edit one account's balance on the latest snapshot (non-finalized year only;
   *  the server rejects otherwise). The server re-derives that year's performance
   *  and resyncs to the budget API (`apiSyncResult`). */
  const updateAccountBalance =
    trpc.netWorth.portfolioSnapshots.updateAccount.useMutation({
      onSuccess: invalidateSnapshotQueries,
    });

  return {
    deleteSnapshot,
    resyncPush,
    updateAccountBalance,
    invalidateSnapshotQueries,
  };
}
