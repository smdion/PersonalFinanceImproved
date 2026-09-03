"use client";

import { useEffect, useRef } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils/format";
import { findOldestDateSource } from "@/lib/pure/data-freshness";

export function DataFreshness({ compact }: { compact?: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.settings.getDataFreshness.useQuery();
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const { data: simplefinStatus } = trpc.simplefin.getStatus.useQuery();
  const hasFiredAutoSync = useRef(false);

  const syncAllMut = trpc.sync.syncAll.useMutation({
    onSuccess: () => {
      utils.sync.getSyncStatus.invalidate();
      utils.sync.getConnection.invalidate();
      utils.sync.getPreview.invalidate();
      utils.savings.invalidate();
      utils.budget.invalidate();
      utils.assets.invalidate();
      utils.mortgage.invalidate();
      utils.networth.invalidate();
    },
  });
  const simplefinSyncMut = trpc.simplefin.syncNow.useMutation({
    onSuccess: () => {
      utils.simplefin.getStatus.invalidate();
      utils.simplefin.listAccounts.invalidate();
      utils.simplefin.listBalanceHistory.invalidate();
    },
  });

  // Auto-sync on mount when data is stale. Fires at most once per mount.
  useEffect(() => {
    if (hasFiredAutoSync.current) return;
    if (!syncStatus) return;
    if (!syncStatus.autoSync.enabled) return;
    if (!syncStatus.service || !syncStatus.connected) return;
    if (syncAllMut.isPending) return;

    const staleMs = syncStatus.autoSync.staleHours * 3_600_000;
    const lastSynced = syncStatus.lastSynced
      ? new Date(syncStatus.lastSynced).getTime()
      : 0;

    if (Date.now() - lastSynced > staleMs) {
      hasFiredAutoSync.current = true;
      syncAllMut.mutate({
        service: syncStatus.service as "ynab" | "actual",
      });
    }
  }, [syncStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;

  const syncLabel = syncStatus?.service?.toUpperCase();
  const syncDate = syncStatus?.lastSynced
    ? formatDate(syncStatus.lastSynced.toString())
    : null;

  const budgetApiCanSync = !!(syncStatus?.service && syncStatus.connected);
  const simplefinCanSync = !!simplefinStatus?.connected;
  const canSync = budgetApiCanSync || simplefinCanSync;
  const isSyncing = syncAllMut.isPending || simplefinSyncMut.isPending;

  const handleSync = () => {
    if (!canSync || isSyncing) return;
    if (budgetApiCanSync) {
      syncAllMut.mutate({
        service: syncStatus!.service! as "ynab" | "actual",
      });
    }
    if (simplefinCanSync) {
      simplefinSyncMut.mutate();
    }
  };

  const simplefinDate =
    simplefinStatus?.connected && simplefinStatus.lastSyncedAt
      ? formatDate(simplefinStatus.lastSyncedAt.toString())
      : null;
  const simplefinHasError = !!(
    simplefinStatus?.connected && simplefinStatus.lastError
  );

  const oldestRaw = findOldestDateSource([
    data.balanceDate,
    data.performanceDate,
    data.basisDate,
    syncStatus?.lastSynced?.toString(),
    simplefinStatus?.connected
      ? simplefinStatus.lastSyncedAt?.toString()
      : null,
  ]);
  const oldestLabel = oldestRaw ? formatDate(oldestRaw) : null;

  const tooltipContent = (
    <div className="text-label space-y-1">
      <div className="text-caption mb-1 font-medium tracking-wider text-slate-300 uppercase">
        Data Updated
      </div>
      {data.balanceDate && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Balance</span>
          <span>{formatDate(data.balanceDate)}</span>
        </div>
      )}
      {data.performanceDate && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Performance</span>
          <span>{formatDate(data.performanceDate)}</span>
        </div>
      )}
      {data.basisDate && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Basis</span>
          <span>{formatDate(data.basisDate)}</span>
        </div>
      )}
      {syncLabel && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">{syncLabel}</span>
          <span>{syncDate ?? "never"}</span>
        </div>
      )}
      {simplefinStatus?.connected && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">
            SimpleFIN
            {simplefinHasError && (
              <span
                className="ml-1 text-amber-400"
                title={simplefinStatus.lastError ?? undefined}
              >
                ⚠
              </span>
            )}
          </span>
          <span>{simplefinDate ?? "never"}</span>
        </div>
      )}
      {isSyncing && (
        <div className="text-caption pt-1 text-center text-slate-500">
          Syncing…
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <TooltipPrimitive.Root delayDuration={300}>
        <TooltipPrimitive.Trigger asChild>
          <button
            className="text-faint hover:text-primary relative flex w-full items-center justify-center p-2 transition-colors disabled:opacity-50"
            onClick={handleSync}
            disabled={isSyncing}
            title={canSync ? "Sync data" : "Data freshness"}
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
            />
            {simplefinHasError && (
              <span
                className="text-caption absolute top-1 right-1 leading-none text-amber-400"
                aria-label="Sync error"
              >
                ⚠
              </span>
            )}
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            align="center"
            sideOffset={8}
            className="animate-in fade-in-0 zoom-in-95 z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-100 shadow-xl dark:bg-slate-700"
          >
            {tooltipContent}
            <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-700" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    );
  }

  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>
        <button
          className="text-faint hover:text-primary hover:bg-surface-elevated flex min-h-[44px] w-full items-center gap-3 rounded px-3 py-2 text-sm transition-colors disabled:opacity-50"
          onClick={handleSync}
          disabled={isSyncing}
          title={canSync ? "Sync data" : "Data freshness"}
        >
          <RefreshCw
            className={`h-4 w-4 shrink-0 ${isSyncing ? "animate-spin" : ""}`}
          />
          <span className="text-label">
            Data{oldestLabel ? `: ${oldestLabel}` : ""}
          </span>
          {simplefinHasError && (
            <span className="text-amber-400" aria-label="Sync error">
              ⚠
            </span>
          )}
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="center"
          sideOffset={8}
          className="animate-in fade-in-0 zoom-in-95 z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-100 shadow-xl dark:bg-slate-700"
        >
          {tooltipContent}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
