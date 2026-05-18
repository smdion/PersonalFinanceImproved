"use client";

import { useEffect, useRef } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils/format";

export function DataFreshness({ compact }: { compact?: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.settings.getDataFreshness.useQuery();
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
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

  const canSync = !!(syncStatus?.service && syncStatus.connected);

  const handleSync = () => {
    if (!canSync || syncAllMut.isPending) return;
    syncAllMut.mutate({
      service: syncStatus!.service! as "ynab" | "actual",
    });
  };

  // Oldest date across all sources
  const dates = [data.balanceDate, data.performanceDate, syncDate].filter(
    Boolean,
  ) as string[];
  const oldestLabel = dates.length > 0 ? dates[dates.length - 1] : null;

  const tooltipContent = (
    <div className="text-[11px] space-y-1">
      <div className="font-medium text-slate-300 uppercase tracking-wider text-[10px] mb-1">
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
      {syncLabel && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">{syncLabel}</span>
          <span>{syncDate ?? "never"}</span>
        </div>
      )}
      {syncAllMut.isPending && (
        <div className="pt-1 text-[10px] text-slate-500 text-center">
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
            className="w-full flex items-center justify-center p-2 text-faint hover:text-primary transition-colors disabled:opacity-50"
            onClick={handleSync}
            disabled={syncAllMut.isPending}
            title={canSync ? "Sync data" : "Data freshness"}
          >
            <RefreshCw
              className={`w-4 h-4 ${syncAllMut.isPending ? "animate-spin" : ""}`}
            />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            align="center"
            sideOffset={8}
            className="z-[9999] rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2.5 text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95"
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
          className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-faint hover:text-primary hover:bg-surface-elevated transition-colors min-h-[44px] disabled:opacity-50"
          onClick={handleSync}
          disabled={syncAllMut.isPending}
          title={canSync ? "Sync data" : "Data freshness"}
        >
          <RefreshCw
            className={`w-4 h-4 shrink-0 ${syncAllMut.isPending ? "animate-spin" : ""}`}
          />
          <span className="text-[11px]">
            Data{oldestLabel ? `: ${oldestLabel}` : ""}
          </span>
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="center"
          sideOffset={8}
          className="z-[9999] rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2.5 text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          {tooltipContent}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
