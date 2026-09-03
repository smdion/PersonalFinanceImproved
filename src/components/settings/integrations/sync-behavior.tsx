"use client";

/** Auto-sync-on-page-load settings, extracted verbatim from IntegrationsSettings so it can be its own left-nav section in the Integrations shell. */
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";

export function SyncBehaviorSettings() {
  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const utils = trpc.useUtils();
  const upsertSetting = trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => utils.sync.getSyncStatus.invalidate(),
  });

  const autoEnabled = syncStatus?.autoSync.enabled ?? true;
  const staleHours = syncStatus?.autoSync.staleHours ?? 4;

  return (
    <Card className="space-y-3 p-4">
      <div className="text-sm font-medium">Sync Behavior</div>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <div>
          <div className="text-primary text-sm">Auto-sync on page load</div>
          <div className="text-muted text-xs">
            Automatically sync when data is stale
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoEnabled}
          disabled={upsertSetting.isPending}
          onChange={(e) =>
            upsertSetting.mutate({
              key: "sync_auto_enabled",
              value: e.target.checked ? "true" : "false",
            })
          }
          className="h-4 w-4 accent-blue-600"
        />
      </label>
      <label className="flex items-center justify-between gap-4">
        <div className="text-muted text-sm">Consider stale after</div>
        <select
          value={String(staleHours)}
          disabled={!autoEnabled || upsertSetting.isPending}
          onChange={(e) =>
            upsertSetting.mutate({
              key: "sync_auto_stale_hours",
              value: e.target.value,
            })
          }
          className="border-surface-strong bg-surface-primary text-primary rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          <option value="1">1 hour</option>
          <option value="2">2 hours</option>
          <option value="4">4 hours</option>
          <option value="8">8 hours</option>
          <option value="24">24 hours</option>
        </select>
      </label>
    </Card>
  );
}
