"use client";

import { useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils/format";

export function DataFreshness({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data } = trpc.settings.getDataFreshness.useQuery();
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
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
        <div className="flex justify-between gap-4 items-center">
          <span className="text-slate-400">{syncLabel}</span>
          <span className="flex items-center gap-1.5">
            {syncDate ?? "never"}
            <button
              onClick={(e) => {
                e.stopPropagation();
                syncAllMut.mutate({
                  service: syncStatus!.service! as "ynab" | "actual",
                });
              }}
              disabled={syncAllMut.isPending}
              className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
              title="Refresh sync"
            >
              <RefreshCw
                className={`w-3 h-3 ${syncAllMut.isPending ? "animate-spin" : ""}`}
              />
            </button>
          </span>
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <TooltipPrimitive.Root
        delayDuration={200}
        open={open}
        onOpenChange={setOpen}
      >
        <TooltipPrimitive.Trigger asChild>
          <button
            className="w-full flex items-center justify-center p-2 text-faint hover:text-primary transition-colors"
            onClick={() => setOpen((o) => !o)}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            align="center"
            sideOffset={8}
            className="z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95"
            onPointerDownOutside={() => setOpen(false)}
          >
            {tooltipContent}
            <TooltipPrimitive.Arrow className="fill-slate-900" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    );
  }

  return (
    <TooltipPrimitive.Root
      delayDuration={200}
      open={open}
      onOpenChange={setOpen}
    >
      <TooltipPrimitive.Trigger asChild>
        <button
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded text-sm text-faint hover:text-primary hover:bg-surface-elevated transition-colors"
          onClick={() => setOpen((o) => !o)}
        >
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline text-[11px]">
            Data{oldestLabel ? `: ${oldestLabel}` : ""}
          </span>
          <span className="md:hidden text-[11px]">
            Data{oldestLabel ? `: ${oldestLabel}` : ""}
          </span>
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="center"
          sideOffset={8}
          className="z-[9999] rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95"
          onPointerDownOutside={() => setOpen(false)}
        >
          {tooltipContent}
          <TooltipPrimitive.Arrow className="fill-slate-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
