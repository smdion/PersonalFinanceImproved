import type { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";
import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { formatDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import type { Dispatch, SetStateAction } from "react";

export type PortfolioSyncBannerProps = {
  canEdit: boolean;
  clearSyncPending: () => void;
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"];
  syncPending: ReturnType<typeof useSnapshotSyncPending>["pending"];
  syncPendingSnapshot: (snapshotId: number) => Promise<void>;
  syncServiceLabel: string;
};

/** The banner for balance edits not yet pushed to the budget app. */
export function PortfolioSyncBanner({
  canEdit,
  clearSyncPending,
  resyncPush,
  syncPending,
  syncPendingSnapshot,
  syncServiceLabel,
}: PortfolioSyncBannerProps) {
  return (
    <>
      {/* Un-synced balance edits, persisted in localStorage; nothing syncs on
          its own: push here or in the expanded snapshot row. */}
      {canEdit && syncPending && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <span className="font-medium">
            {syncPending.count} balance change
            {syncPending.count === 1 ? "" : "s"} on the{" "}
            {formatDate(syncPending.snapshotDate, "medium")} snapshot{" "}
            {syncPending.count === 1 ? "hasn't" : "haven't"} been pushed to{" "}
            {syncServiceLabel} yet.
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={resyncPush.isPending}
              onClick={() => void syncPendingSnapshot(syncPending.snapshotId)}
              className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {resyncPush.isPending
                ? "Syncing…"
                : `Sync to ${syncServiceLabel}`}
            </button>
            <button
              type="button"
              onClick={() => clearSyncPending()}
              className="text-amber-700 hover:underline"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
    </>
  );
}

export type PortfolioHeaderProps = {
  canEdit: boolean;
  setShowChart: Dispatch<SetStateAction<boolean>>;
  setShowNewSnapshot: Dispatch<SetStateAction<boolean>>;
  setShowQuickLook: Dispatch<SetStateAction<boolean>>;
  showChart: boolean;
  showQuickLook: boolean;
  snapshotDate: string | null | undefined;
};

/** The page header, with the Quick Look, chart and new-snapshot buttons. */
export function PortfolioHeader({
  canEdit,
  setShowChart,
  setShowNewSnapshot,
  setShowQuickLook,
  showChart,
  showQuickLook,
  snapshotDate,
}: PortfolioHeaderProps) {
  return (
    <PageHeader
      title="Portfolio Snapshots"
      subtitle={
        snapshotDate ? `Last snapshot: ${formatDate(snapshotDate)}` : undefined
      }
    >
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowQuickLook(!showQuickLook)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            showQuickLook
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-surface-strong text-secondary hover:bg-surface-strong"
          }`}
        >
          {showQuickLook ? "Hide Stats" : "Quick Look"}
        </button>
        <button
          type="button"
          onClick={() => setShowChart(!showChart)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            showChart
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-surface-strong text-secondary hover:bg-surface-strong"
          }`}
        >
          {showChart ? "Hide Chart" : "Chart"}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowNewSnapshot(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            New Snapshot
          </button>
        )}
      </span>
    </PageHeader>
  );
}
