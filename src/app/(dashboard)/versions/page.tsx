"use client";

/** Database version snapshots page for browsing, comparing, and restoring historical data states. */

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

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
        name: `Pre-restore backup (${new Date().toISOString().split("T")[0]})`,
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
      const filename =
        match?.[1] ??
        `ledgr-backup-${new Date().toISOString().split("T")[0]}.json`;
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
                <code className="rounded bg-blue-100 px-1 py-0.5 text-xs font-mono dark:bg-blue-900/50">
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
          <div className="bg-surface-primary rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-primary mb-4">
              Create Version
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Before budget restructure"
                  className="w-full text-sm border border-strong rounded px-3 py-2 bg-surface-primary text-primary focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  Description{""}
                  <span className="text-faint font-normal">(optional)</span>
                </label>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="What changes are you about to make?"
                  rows={2}
                  className="w-full text-sm border border-strong rounded px-3 py-2 bg-surface-primary text-primary focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4 pt-3 border-t border-subtle">
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
                className="px-3 py-1.5 text-xs font-medium text-muted bg-surface-elevated rounded hover:bg-surface-strong"
              >
                Cancel
              </button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-600 mt-2">
                {createMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Settings row: schedule + retention + backup/restore */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card title="Auto Schedule">
          <div className="flex items-center gap-2">
            <select
              value={scheduleData?.schedule ?? "daily"}
              onChange={(e) => {
                const val = e.target.value as
                  | "off"
                  | "daily"
                  | "weekly"
                  | "monthly"
                  | "custom";
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
              className="text-sm border border-strong rounded px-2 py-1 bg-surface-primary text-primary"
            >
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sunday)</option>
              <option value="monthly">Monthly (1st)</option>
              <option value="custom">Custom (cron)</option>
            </select>
            {setScheduleMutation.isPending && (
              <span className="text-xs text-faint animate-pulse">
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
                  className="flex-1 text-sm font-mono border border-strong rounded px-2 py-1 bg-surface-primary text-primary"
                />
                <button
                  onClick={() => {
                    const expr = cronExpression || "0 2 * * *";
                    setScheduleMutation.mutate({
                      schedule: "custom",
                      cronExpression: expr,
                    });
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1"
                >
                  Save
                </button>
              </div>
            )}
          <p className="text-xs text-faint mt-2">
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
                className="w-20 text-sm border border-strong rounded px-2 py-1 bg-surface-primary text-primary"
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
                className="text-xs text-faint hover:text-secondary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-primary font-mono">
                {retentionData?.retentionCount ?? 30}
              </span>
              <span className="text-sm text-muted">auto versions kept</span>
              <button
                onClick={() => {
                  setRetentionValue(retentionData?.retentionCount ?? 30);
                  setEditingRetention(true);
                }}
                className="text-xs text-blue-600 hover:text-blue-700 ml-auto"
              >
                Edit
              </button>
            </div>
          )}
          <p className="text-xs text-faint mt-2">
            Manual versions are never auto-deleted.
          </p>
        </Card>

        <Card title="Backup / Restore">
          <div className="flex flex-col gap-2">
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 w-full"
            >
              Download Backup
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-medium text-secondary bg-surface-elevated rounded hover:bg-surface-strong w-full"
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
          <p className="text-xs text-faint mt-2">
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
              <p className="text-xs text-muted">
                Type <span className="font-mono font-bold">delete</span> to
                confirm:
              </p>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="delete"
                className="w-full px-2 py-1.5 text-sm border border-red-300 rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-red-400"
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
                  className="px-3 py-1.5 text-xs font-medium text-secondary bg-surface-elevated rounded hover:bg-surface-strong transition-colors"
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
                className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 w-full transition-colors"
              >
                Reset App — Clear All Data
              </button>
              <p className="text-xs text-faint mt-2">
                Removes all financial data. Download a backup first.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Version list */}
      <Card title="All Versions">
        {isLoading ? (
          <div className="text-sm text-muted animate-pulse py-8 text-center">
            Loading versions...
          </div>
        ) : !versions || versions.length === 0 ? (
          <EmptyState
            message="No versions yet"
            hint="Create a manual version or wait for the next automatic version."
          />
        ) : (
          <div className="overflow-x-auto -mx-3 sm:-mx-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2 font-medium text-muted">Name</th>
                  <th className="px-3 py-2 font-medium text-muted">Type</th>
                  <th className="px-3 py-2 font-medium text-muted text-right">
                    Tables
                  </th>
                  <th className="px-3 py-2 font-medium text-muted text-right">
                    Rows
                  </th>
                  <th className="px-3 py-2 font-medium text-muted text-right">
                    Size
                  </th>
                  <th className="px-3 py-2 font-medium text-muted">Created</th>
                  <th className="px-3 py-2 font-medium text-muted">By</th>
                  <th className="px-3 py-2 font-medium text-muted text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-subtle hover:bg-surface-sunken"
                  >
                    <td className="px-3 py-2 text-primary">
                      <div className="font-medium">{v.name}</div>
                      {v.description && (
                        <div className="text-xs text-faint mt-0.5 truncate max-w-[200px]">
                          {v.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          v.versionType === "auto"
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {v.versionType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">
                      {v.tableCount}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">
                      {v.totalRows.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted">
                      {formatBytes(v.sizeEstimateBytes)}
                    </td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {formatDate(v.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-muted">{v.createdBy}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setPreviewVersionId(
                              previewVersionId === v.id ? null : v.id,
                            );
                            setPreviewTable("");
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50"
                        >
                          {previewVersionId === v.id ? "Close" : "Preview"}
                        </button>
                        <button
                          onClick={() =>
                            setRestoreTarget({ id: v.id, name: v.name })
                          }
                          className="text-xs text-amber-600 hover:text-amber-700 px-1.5 py-0.5 rounded hover:bg-amber-50"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => setDeleteTarget(v.id)}
                          className="text-xs text-red-600 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50"
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
              <label className="text-xs font-medium text-muted">Table:</label>
              <select
                value={previewTable}
                onChange={(e) => setPreviewTable(e.target.value)}
                className="text-sm border border-strong rounded px-2 py-1 bg-surface-primary text-primary"
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {versionDetail.tables?.map((t) => (
                <div
                  key={t.tableName}
                  className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
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
                <div className="text-xs text-faint mb-1">
                  Showing {Math.min(previewData.rows.length, 50)} of{""}
                  {previewData.rowCount} rows
                </div>
                {previewData.rows.length > 0 ? (
                  <table className="w-full text-xs border">
                    <thead>
                      <tr className="bg-surface-sunken">
                        {Object.keys(
                          previewData.rows[0] as Record<string, unknown>,
                        ).map((col) => (
                          <th
                            key={col}
                            className="px-2 py-1 text-left font-medium text-muted border-b"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-subtle hover:bg-surface-sunken"
                        >
                          {Object.values(row as Record<string, unknown>).map(
                            (val, j) => (
                              <td
                                key={j}
                                className="px-2 py-1 text-secondary font-mono max-w-[200px] truncate"
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
                  <div className="text-xs text-faint text-center py-4">
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
          <div className="bg-surface-primary rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-primary mb-2">
              Restore Version
            </h3>
            <p className="text-sm text-muted mb-3">
              This will replace <strong>all current data</strong> with the data
              from <strong>&ldquo;{restoreTarget.name}&rdquo;</strong>. This
              action cannot be undone unless you create a backup first.
            </p>

            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={restoreCreateBackup}
                onChange={(e) => setRestoreCreateBackup(e.target.checked)}
                className="rounded border-strong"
              />
              <span className="text-sm text-secondary">
                Create backup of current state before restoring
              </span>
            </label>

            <div className="mb-4">
              <label className="block text-sm font-medium text-secondary mb-1">
                Type the version name to confirm:
              </label>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder={restoreTarget.name}
                className="w-full text-sm border border-strong rounded px-3 py-2 bg-surface-primary text-primary"
              />
            </div>

            <div className="flex gap-2 pt-3 border-t border-subtle">
              <button
                onClick={handleRestore}
                disabled={
                  restoreConfirmText !== restoreTarget.name ||
                  restoreMutation.isPending ||
                  createMutation.isPending
                }
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded hover:bg-amber-700 disabled:opacity-50"
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
                className="px-3 py-1.5 text-xs font-medium text-muted bg-surface-elevated rounded hover:bg-surface-strong"
              >
                Cancel
              </button>
            </div>
            {restoreMutation.isError && (
              <p className="text-xs text-red-600 mt-2">
                {restoreMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-primary rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-primary mb-2">
              Delete Version
            </h3>
            <p className="text-sm text-muted mb-4">
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
                className="px-3 py-1.5 text-xs font-medium text-muted bg-surface-elevated rounded hover:bg-surface-strong"
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
          <div className="bg-surface-primary rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-primary mb-2">
              Import Backup
            </h3>
            <p className="text-sm text-muted mb-1">
              This will replace <strong>all current data</strong> with the
              contents of:
            </p>
            <p className="text-sm font-medium text-primary mb-3 font-mono">
              {importFile?.name}
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-secondary mb-1">
                Type IMPORT to confirm:
              </label>
              <input
                type="text"
                value={importConfirmText}
                onChange={(e) => setImportConfirmText(e.target.value)}
                placeholder="IMPORT"
                className="w-full text-sm border border-strong rounded px-3 py-2 bg-surface-primary text-primary"
              />
            </div>

            {importError && (
              <p className="text-xs text-red-600 mb-3">{importError}</p>
            )}

            <div className="flex gap-2 pt-3 border-t border-subtle">
              <button
                onClick={handleImport}
                disabled={importConfirmText !== "IMPORT" || importLoading}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded hover:bg-amber-700 disabled:opacity-50"
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
                className="px-3 py-1.5 text-xs font-medium text-muted bg-surface-elevated rounded hover:bg-surface-strong"
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
