"use client";

/** Database versions page for browsing, comparing, and restoring historical data states. */

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { localDateStr } from "@/lib/utils/date";

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VersionsPage() {
  const utils = trpc.useUtils();
  const { data: versions, isLoading } = trpc.version.list.useQuery();
  const { data: retentionData } = trpc.version.getRetention.useQuery();
  const { data: scheduleData } = trpc.version.getSchedule.useQuery();
  const { data: upgradeBanner } = trpc.version.getUpgradeBanner.useQuery();

  const createMutation = trpc.version.create.useMutation({
    onSuccess: () => {
      utils.version.list.invalidate();
      setShowCreateForm(false);
      setCreateName("");
      setCreateDescription("");
    },
  });
  const deleteMutation = trpc.version.delete.useMutation({
    onSuccess: () => utils.version.list.invalidate(),
  });
  const restoreMutation = trpc.version.restore.useMutation({
    onSuccess: () => {
      utils.version.list.invalidate();
      setRestoreTarget(null);
      setRestoreConfirmText("");
    },
  });
  const setRetentionMutation = trpc.version.setRetention.useMutation({
    onSuccess: () => utils.version.getRetention.invalidate(),
  });
  const dismissBannerMutation = trpc.version.dismissUpgradeBanner.useMutation({
    onSuccess: () => utils.version.getUpgradeBanner.invalidate(),
  });
  const setScheduleMutation = trpc.version.setSchedule.useMutation({
    onSuccess: () => utils.version.getSchedule.invalidate(),
  });

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  // Restore state
  const [restoreTarget, setRestoreTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreCreateBackup, setRestoreCreateBackup] = useState(true);

  // Preview state
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const [previewTable, setPreviewTable] = useState<string>("");

  // Retention editing
  const [editingRetention, setEditingRetention] = useState(false);
  const [retentionValue, setRetentionValue] = useState(30);

  // Import state
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importConfirmText, setImportConfirmText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [cronExpression, setCronExpression] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const resetMutation = trpc.version.resetAllData.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setShowResetConfirm(false);
      setResetConfirmText("");
    },
  });

  // Preview data
  const { data: previewData } = trpc.version.getPreview.useQuery(
    { versionId: previewVersionId!, tableName: previewTable },
    { enabled: !!previewVersionId && !!previewTable },
  );

  const { data: versionDetail } = trpc.version.getById.useQuery(
    { id: previewVersionId! },
    { enabled: !!previewVersionId },
  );

  const handleCreate = () => {
    if (!createName.trim()) return;
    createMutation.mutate({
      name: createName.trim(),
      description: createDescription.trim() || undefined,
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
    setDeleteTarget(null);
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    // Optionally create a backup before restoring
    if (restoreCreateBackup) {
      await createMutation.mutateAsync({
        name: `Pre-restore backup (${localDateStr()})`,
        description: `Auto-created before restoring"${restoreTarget.name}"`,
      });
    }
    restoreMutation.mutate({ id: restoreTarget.id });
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/versions/export");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        alert(`Export failed: ${err.error ?? res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? `ledgr-backup-${localDateStr()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed: network error");
    }
  };

  const handleImportSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setShowImportConfirm(true);
      setImportConfirmText("");
      setImportError(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || importConfirmText !== "IMPORT") return;
    setImportLoading(true);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await fetch("/api/versions/import", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      utils.version.list.invalidate();
      setShowImportConfirm(false);
      setImportFile(null);
      setImportConfirmText("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Versions"
        subtitle="Full-database versioning with automatic and manual save points"
      >
        <Button size="xs" onClick={() => setShowCreateForm(true)}>
          Create Version
        </Button>
      </PageHeader>

      {/* Upgrade banner */}
      {upgradeBanner && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                Upgrade Complete: v0.1.x → v0.2.0
              </h3>
              <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
                Your data was migrated automatically. A pre-upgrade backup was
                saved to{" "}
                <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900/50">
                  {upgradeBanner.backupPath}
                </code>
              </p>
              <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-400">
                Your existing v0.1.x backups can still be imported — they are
                automatically transformed to the new schema.
              </p>
            </div>
            <button
              onClick={() => dismissBannerMutation.mutate()}
              disabled={dismissBannerMutation.isPending}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
            <h3 className="text-primary mb-4 text-lg font-semibold">
              Create Version
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-secondary mb-1 block text-sm font-medium">
                  Name
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Before budget restructure"
                  className="border-strong bg-surface-primary text-primary w-full rounded border px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-secondary mb-1 block text-sm font-medium">
                  Description{" "}
                  <span className="text-faint font-normal">(optional)</span>
                </label>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="What changes are you about to make?"
                  rows={2}
                  className="border-strong bg-surface-primary text-primary w-full rounded border px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="border-subtle mt-4 flex gap-2 border-t pt-3">
              <Button
                size="xs"
                onClick={handleCreate}
                disabled={!createName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateName("");
                  setCreateDescription("");
                }}
                className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
            {createMutation.isError && (
              <p className="mt-2 text-xs text-red-600">
                {createMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Settings row: schedule + retention + backup/restore */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card title="Auto Schedule">
          <div className="flex items-center gap-2">
            <select
              value={scheduleData?.schedule ?? "daily"}
              onChange={(e) => {
                const val = e.target.value as
                  "off" | "daily" | "weekly" | "monthly" | "custom";
                if (val !== "custom") {
                  setScheduleMutation.mutate({ schedule: val });
                  setCronExpression("");
                } else {
                  setCronExpression(
                    scheduleData?.cronExpression ?? "0 2 * * *",
                  );
                  setScheduleMutation.mutate({
                    schedule: val,
                    cronExpression: scheduleData?.cronExpression ?? "0 2 * * *",
                  });
                }
              }}
              className="border-strong bg-surface-primary text-primary rounded border px-2 py-1 text-sm"
            >
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sunday)</option>
              <option value="monthly">Monthly (1st)</option>
              <option value="custom">Custom (cron)</option>
            </select>
            {setScheduleMutation.isPending && (
              <span className="text-faint animate-pulse text-xs">
                Saving...
              </span>
            )}
          </div>
          {(scheduleData?.schedule === "custom" || cronExpression) &&
            scheduleData?.schedule === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={
                    cronExpression ||
                    scheduleData?.cronExpression ||
                    "0 2 * * *"
                  }
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 2 * * *"
                  className="border-strong bg-surface-primary text-primary flex-1 rounded border px-2 py-1 font-mono text-sm"
                />
                <button
                  onClick={() => {
                    const expr = cronExpression || "0 2 * * *";
                    setScheduleMutation.mutate({
                      schedule: "custom",
                      cronExpression: expr,
                    });
                  }}
                  className="px-2 py-1 text-xs text-blue-600 hover:text-blue-700"
                >
                  Save
                </button>
              </div>
            )}
          <p className="text-faint mt-2 text-xs">
            {scheduleData?.schedule === "custom"
              ? "Configure the external cron job to call the version API endpoint on this schedule."
              : "Automatic versions are created by a cron job on the configured schedule."}
          </p>
        </Card>

        <Card title="Retention">
          {editingRetention ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={retentionValue}
                onChange={(e) => setRetentionValue(Number(e.target.value))}
                className="border-strong bg-surface-primary text-primary w-20 rounded border px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  setRetentionMutation.mutate({ count: retentionValue });
                  setEditingRetention(false);
                }}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => setEditingRetention(false)}
                className="text-faint hover:text-secondary text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-primary font-mono text-2xl font-semibold">
                {retentionData?.retentionCount ?? 30}
              </span>
              <span className="text-muted text-sm">auto versions kept</span>
              <button
                onClick={() => {
                  setRetentionValue(retentionData?.retentionCount ?? 30);
                  setEditingRetention(true);
                }}
                className="ml-auto text-xs text-blue-600 hover:text-blue-700"
              >
                Edit
              </button>
            </div>
          )}
          <p className="text-faint mt-2 text-xs">
            Manual versions are never auto-deleted.
          </p>
        </Card>

        <Card title="Backup / Restore">
          <div className="flex flex-col gap-2">
            <button
              onClick={handleExport}
              className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Download Backup
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-secondary bg-surface-elevated hover:bg-surface-strong w-full rounded px-3 py-1.5 text-xs font-medium"
            >
              Import Backup
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportSelect}
              className="hidden"
            />
          </div>
          <p className="text-faint mt-2 text-xs">
            Export all data as JSON for disaster recovery or environment
            migration.
          </p>
        </Card>

        <Card title="Danger Zone">
          {showResetConfirm ? (
            <div className="space-y-3">
              <p className="text-xs text-red-600">
                This will permanently delete all your financial data. Versions
                and app settings will be preserved. This cannot be undone.
              </p>
              <p className="text-muted text-xs">
                Type <span className="font-mono font-bold">delete</span> to
                confirm:
              </p>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="delete"
                className="bg-surface-primary w-full rounded border border-red-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-red-400 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="xs"
                  className="flex-1"
                  onClick={() =>
                    resetMutation.mutate({ confirmation: "delete" })
                  }
                  disabled={
                    resetConfirmText !== "delete" || resetMutation.isPending
                  }
                >
                  {resetMutation.isPending ? "Clearing..." : "Clear All Data"}
                </Button>
                <button
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmText("");
                  }}
                  className="text-secondary bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
              {resetMutation.error && (
                <p className="text-xs text-red-600">
                  {resetMutation.error.message}
                </p>
              )}
            </div>
          ) : (
            <div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Reset App — Clear All Data
              </button>
              <p className="text-faint mt-2 text-xs">
                Removes all financial data. Download a backup first.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Version list */}
      <Card title="All Versions">
        {isLoading ? (
          <div className="text-muted animate-pulse py-8 text-center text-sm">
            Loading versions...
          </div>
        ) : !versions || versions.length === 0 ? (
          <EmptyState
            message="No versions yet"
            hint="Create a manual version or wait for the next automatic version."
          />
        ) : (
          <div className="-mx-3 overflow-x-auto sm:-mx-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="text-muted px-3 py-2 font-medium">Name</th>
                  <th className="text-muted px-3 py-2 font-medium">Type</th>
                  <th className="text-muted px-3 py-2 text-right font-medium">
                    Tables
                  </th>
                  <th className="text-muted px-3 py-2 text-right font-medium">
                    Rows
                  </th>
                  <th className="text-muted px-3 py-2 text-right font-medium">
                    Size
                  </th>
                  <th className="text-muted px-3 py-2 font-medium">Created</th>
                  <th className="text-muted px-3 py-2 font-medium">By</th>
                  <th className="text-muted px-3 py-2 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr
                    key={v.id}
                    className="border-subtle hover:bg-surface-sunken border-b"
                  >
                    <td className="text-primary px-3 py-2">
                      <div className="font-medium">{v.name}</div>
                      {v.description && (
                        <div className="text-faint mt-0.5 max-w-[200px] truncate text-xs">
                          {v.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-caption inline-block rounded px-1.5 py-0.5 font-medium ${
                          v.versionType === "auto"
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {v.versionType}
                      </span>
                    </td>
                    <td className="text-muted px-3 py-2 text-right font-mono">
                      {v.tableCount}
                    </td>
                    <td className="text-muted px-3 py-2 text-right font-mono">
                      {v.totalRows.toLocaleString()}
                    </td>
                    <td className="text-muted px-3 py-2 text-right font-mono">
                      {formatBytes(v.sizeEstimateBytes)}
                    </td>
                    <td className="text-muted px-3 py-2 whitespace-nowrap">
                      {formatDate(v.createdAt)}
                    </td>
                    <td className="text-muted px-3 py-2">{v.createdBy}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setPreviewVersionId(
                              previewVersionId === v.id ? null : v.id,
                            );
                            setPreviewTable("");
                          }}
                          className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {previewVersionId === v.id ? "Close" : "Preview"}
                        </button>
                        <button
                          onClick={() =>
                            setRestoreTarget({ id: v.id, name: v.name })
                          }
                          className="rounded px-1.5 py-0.5 text-xs text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => setDeleteTarget(v.id)}
                          className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Preview panel */}
      {previewVersionId && versionDetail && (
        <Card title={`Preview: ${versionDetail.name}`} className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-muted text-xs font-medium">Table:</label>
              <select
                value={previewTable}
                onChange={(e) => setPreviewTable(e.target.value)}
                className="border-strong bg-surface-primary text-primary rounded border px-2 py-1 text-sm"
              >
                <option value="">Select a table...</option>
                {versionDetail.tables?.map((t) => (
                  <option key={t.tableName} value={t.tableName}>
                    {t.tableName} ({t.rowCount} rows)
                  </option>
                ))}
              </select>
            </div>

            {/* Per-table row count summary */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
              {versionDetail.tables?.map((t) => (
                <div
                  key={t.tableName}
                  className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${
                    previewTable === t.tableName
                      ? "bg-blue-100 text-blue-800"
                      : "bg-surface-sunken text-muted hover:bg-surface-elevated"
                  }`}
                  onClick={() => setPreviewTable(t.tableName)}
                >
                  <span className="font-medium">{t.tableName}</span>
                  <span className="ml-1 font-mono">({t.rowCount})</span>
                </div>
              ))}
            </div>

            {/* Preview rows */}
            {previewTable && previewData && (
              <div className="overflow-x-auto">
                <div className="text-faint mb-1 text-xs">
                  Showing {Math.min(previewData.rows.length, 50)} of{" "}
                  {previewData.rowCount} rows
                </div>
                {previewData.rows.length > 0 ? (
                  <table className="w-full border text-xs">
                    <thead>
                      <tr className="bg-surface-sunken">
                        {Object.keys(
                          previewData.rows[0] as Record<string, unknown>,
                        ).map((col) => (
                          <th
                            key={col}
                            className="text-muted border-b px-2 py-1 text-left font-medium"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.map((row, i) => (
                        <tr
                          key={String((row as Record<string, unknown>).id ?? i)}
                          className="border-subtle hover:bg-surface-sunken border-b"
                        >
                          {Object.entries(row as Record<string, unknown>).map(
                            ([col, val]) => (
                              <td
                                key={col}
                                className="text-secondary max-w-[200px] truncate px-2 py-1 font-mono"
                              >
                                {val === null ? (
                                  <span className="text-faint">null</span>
                                ) : typeof val === "object" ? (
                                  JSON.stringify(val).slice(0, 80)
                                ) : (
                                  String(val)
                                )}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-faint py-4 text-center text-xs">
                    Table is empty in this version.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Restore confirmation modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
            <h3 className="text-primary mb-2 text-lg font-semibold">
              Restore Version
            </h3>
            <p className="text-muted mb-3 text-sm">
              This will replace <strong>all current data</strong> with the data
              from <strong>&ldquo;{restoreTarget.name}&rdquo;</strong>. This
              action cannot be undone unless you create a backup first.
            </p>

            <label className="mb-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={restoreCreateBackup}
                onChange={(e) => setRestoreCreateBackup(e.target.checked)}
                className="border-strong rounded"
              />
              <span className="text-secondary text-sm">
                Create backup of current state before restoring
              </span>
            </label>

            <div className="mb-4">
              <label className="text-secondary mb-1 block text-sm font-medium">
                Type the version name to confirm:
              </label>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder={restoreTarget.name}
                className="border-strong bg-surface-primary text-primary w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            <div className="border-subtle flex gap-2 border-t pt-3">
              <button
                onClick={handleRestore}
                disabled={
                  restoreConfirmText !== restoreTarget.name ||
                  restoreMutation.isPending ||
                  createMutation.isPending
                }
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {restoreMutation.isPending || createMutation.isPending
                  ? "Restoring..."
                  : "Restore"}
              </button>
              <button
                onClick={() => {
                  setRestoreTarget(null);
                  setRestoreConfirmText("");
                }}
                className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
            {restoreMutation.isError && (
              <p className="mt-2 text-xs text-red-600">
                {restoreMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary mx-4 w-full max-w-sm rounded-lg p-6 shadow-xl">
            <h3 className="text-primary mb-2 text-lg font-semibold">
              Delete Version
            </h3>
            <p className="text-muted mb-4 text-sm">
              Are you sure you want to permanently delete this version? This
              cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="xs"
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import confirmation modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
            <h3 className="text-primary mb-2 text-lg font-semibold">
              Import Backup
            </h3>
            <p className="text-muted mb-1 text-sm">
              This will replace <strong>all current data</strong> with the
              contents of:
            </p>
            <p className="text-primary mb-3 font-mono text-sm font-medium">
              {importFile?.name}
            </p>

            <div className="mb-4">
              <label className="text-secondary mb-1 block text-sm font-medium">
                Type IMPORT to confirm:
              </label>
              <input
                type="text"
                value={importConfirmText}
                onChange={(e) => setImportConfirmText(e.target.value)}
                placeholder="IMPORT"
                className="border-strong bg-surface-primary text-primary w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            {importError && (
              <p className="mb-3 text-xs text-red-600">{importError}</p>
            )}

            <div className="border-subtle flex gap-2 border-t pt-3">
              <button
                onClick={handleImport}
                disabled={importConfirmText !== "IMPORT" || importLoading}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {importLoading ? "Importing..." : "Import"}
              </button>
              <button
                onClick={() => {
                  setShowImportConfirm(false);
                  setImportFile(null);
                  setImportConfirmText("");
                  setImportError(null);
                }}
                className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
