"use client";

import { useEffect, useRef } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { budgetApiServiceLabel, formatDate } from "@/lib/utils/format";
import {
  evaluateDataSources,
  type DataSourceStatus,
} from "@/lib/pure/data-freshness";

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

  const statuses = evaluateDataSources({
    balance: data.balanceDate ? { lastUpdated: data.balanceDate } : undefined,
    performance: data.performanceDate
      ? { lastUpdated: data.performanceDate }
      : undefined,
    basis: data.basisDate ? { lastUpdated: data.basisDate } : undefined,
    budgetApi: budgetApiCanSync
      ? { lastUpdated: syncStatus?.lastSynced?.toString() ?? null }
      : undefined,
    simplefin: simplefinCanSync
      ? {
          lastUpdated: simplefinStatus?.lastSyncedAt?.toString() ?? null,
          error: simplefinStatus?.lastError ?? null,
        }
      : undefined,
  });
  const attention = statuses.filter((s) => s.needsAttention);
  const labelFor = (s: DataSourceStatus) =>
    s.source.key === "budgetApi"
      ? budgetApiServiceLabel(syncStatus?.service)
      : s.source.label;
  const whenFor = (s: DataSourceStatus) =>
    s.lastUpdated === null
      ? "never"
      : s.ageDays === 0 && s.source.mode === "automatic"
        ? "today"
        : formatDate(s.lastUpdated, "medium").replace(
            `, ${new Date().getFullYear()}`,
            "",
          );
  const synced = statuses.filter(
    (s) => !s.needsAttention && s.source.mode === "automatic",
  );
  const manual = statuses.filter(
    (s) => !s.needsAttention && s.source.mode === "manual",
  );
  const headline = isSyncing
    ? "Syncing…"
    : attention.length > 0
      ? `${attention.length} need${attention.length === 1 ? "s" : ""} attention`
      : statuses.length > 0
        ? "All current"
        : null;

  const tooltipContent = (
    <div className="text-label max-w-72 space-y-1.5">
      {attention.length > 0 && (
        <div>
          <div className="text-caption mb-0.5 font-medium tracking-wider text-amber-300 uppercase">
            Needs attention
          </div>
          {attention.map((s) => (
            <div key={s.source.key}>
              <span>{labelFor(s)}</span>
              <span className="text-slate-400">
                {" "}
                — {s.reason}
                {s.lastUpdated !== null && ` · updated ${whenFor(s)}`}
              </span>
              {s.source.key === "simplefin" && simplefinStatus?.lastError && (
                <div className="text-caption truncate text-slate-500">
                  {simplefinStatus.lastError}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {synced.length > 0 && (
        <div>
          <span className="text-slate-400">Synced: </span>
          {synced.map((s) => `${labelFor(s)} ${whenFor(s)}`).join(" · ")}
        </div>
      )}
      {manual.length > 0 && (
        <div>
          <span className="text-slate-400">Updated by you: </span>
          {manual.map((s) => `${labelFor(s)} ${whenFor(s)}`).join(" · ")}
        </div>
      )}
      <div className="text-caption pt-0.5 text-slate-500">
        {isSyncing
          ? "Syncing…"
          : canSync
            ? "Click to sync now · details in Settings"
            : "Details in Settings"}
      </div>
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
            {attention.length > 0 && (
              <span
                className="text-caption absolute top-1 right-1 leading-none text-amber-400"
                aria-label="Data needs attention"
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
            Data{headline ? `: ${headline}` : ""}
          </span>
          {attention.length > 0 && !isSyncing && (
            <span className="text-amber-400" aria-label="Data needs attention">
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
