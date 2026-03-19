"use client";

import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils/format";

export function DataFreshness({ compact }: { compact?: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.settings.getDataFreshness.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const syncAllMut = trpc.sync.syncAll.useMutation({
    onSuccess: () => {
      utils.sync.getSyncStatus.invalidate();
      utils.sync.getConnection.invalidate();
      utils.sync.getPreview.invalidate();
    },
  });

  if (!data) return null;

  const syncLabel = syncStatus?.service?.toUpperCase();
  const syncDate = syncStatus?.lastSynced
    ? formatDate(syncStatus.lastSynced.toString())
    : null;

  if (compact) {
    return (
      <div
        className="px-3 py-2 text-[10px] text-muted space-y-0.5"
        title="Data freshness"
      >
        {data.balanceDate && <div>Bal: {formatDate(data.balanceDate)}</div>}
        {data.performanceDate && (
          <div>Perf: {formatDate(data.performanceDate)}</div>
        )}
        {syncLabel && (
          <div className="flex items-center gap-1">
            <span>
              {syncLabel}: {syncDate ?? "never"}
            </span>
            <button
              onClick={() =>
                syncAllMut.mutate({
                  service: syncStatus!.service! as "ynab" | "actual",
                })
              }
              disabled={syncAllMut.isPending}
              className="text-blue-500 hover:text-blue-700 disabled:opacity-50"
              title="Refresh sync"
            >
              {syncAllMut.isPending ? "..." : "\u21BB"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-2 text-[10px] text-muted space-y-0.5">
      <div className="text-muted font-medium uppercase tracking-wider">
        Data Updated
      </div>
      {data.balanceDate && (
        <div className="flex justify-between">
          <span>Balance</span>
          <span>{formatDate(data.balanceDate)}</span>
        </div>
      )}
      {data.performanceDate && (
        <div className="flex justify-between">
          <span>Performance</span>
          <span>{formatDate(data.performanceDate)}</span>
        </div>
      )}
      {syncLabel && (
        <div className="flex justify-between items-center">
          <span>{syncLabel}</span>
          <span className="flex items-center gap-1">
            {syncDate ?? "never"}
            <button
              onClick={() =>
                syncAllMut.mutate({
                  service: syncStatus!.service! as "ynab" | "actual",
                })
              }
              disabled={syncAllMut.isPending}
              className="text-blue-500 hover:text-blue-700 disabled:opacity-50 ml-1"
              title="Refresh sync"
            >
              {syncAllMut.isPending ? "..." : "\u21BB"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
