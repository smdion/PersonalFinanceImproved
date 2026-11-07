"use client";

/**
 * Snapshot-level mutations for the Portfolio page.
 *
 * Also the single source of the "a snapshot changed" invalidation set — it
 * was duplicated inline before, and had already drifted: the delete path
 * invalidated 3 queries, the new-snapshot save path 4 (it also refreshed
 * `getLatest`). `invalidateSnapshotQueries` is now the one list both use.
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

  /** Edit one account's balance on the latest snapshot. The server
   *  re-derives that year's performance figures and auto-resyncs the
   *  corrected balances to the budget API (`apiSyncResult` on the
   *  response). Latest-snapshot / non-finalized-year only — the server
   *  rejects otherwise. */
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
