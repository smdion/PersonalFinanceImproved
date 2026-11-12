"use client";

/** The confirmation before a saved version replaces the household's data. */

import { useId, useState } from "react";
import type { trpc } from "@/lib/trpc";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { ReplacesNote } from "@/components/versions/replaces-note";
import { DataLossWarning } from "@/components/versions/restore-notices";
import { Modal, ModalCancel } from "@/components/ui/modal";

type RestoreDialogProps = {
  restoreTarget: { id: number; name: string } | null;
  restoreDataLoss: { tableName: string; currentRows: number }[] | undefined;
  restoreCreateBackup: boolean;
  setRestoreCreateBackup: (backup: boolean) => void;
  restoreConfirmText: string;
  setRestoreConfirmText: (text: string) => void;
  restoreMutation: ReturnType<typeof trpc.version.restore.useMutation>;
  createMutation: ReturnType<typeof trpc.version.create.useMutation>;
  setRestoreTarget: (target: null) => void;
};

export function RestoreDialog({
  restoreTarget,
  restoreDataLoss,
  restoreCreateBackup,
  setRestoreCreateBackup,
  restoreConfirmText,
  setRestoreConfirmText,
  restoreMutation,
  createMutation,
  setRestoreTarget,
}: RestoreDialogProps) {
  // One run: the pre-restore backup (if asked for), then the restore.
  const [restoring, setRestoring] = useState(false);
  // The opened dialog (each open is a new target object) a backup was made
  // in, so a retry doesn't make another and the next open makes its own.
  const [backedUpFor, setBackedUpFor] = useState<object | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const id = useId();
  if (!restoreTarget) return null;
  const target = restoreTarget;
  const handleRestore = async () => {
    setRestoring(true);
    setBackupError(null);
    try {
      if (restoreCreateBackup && backedUpFor !== target) {
        const made = await createMutation
          .mutateAsync({
            name: `Pre-restore backup (${calendarDateOf(new Date())})`,
            description: `Auto-created before restoring "${target.name}"`,
          })
          .then(
            () => true,
            (err: unknown) => {
              const why = err instanceof Error ? `: ${err.message}` : "";
              setBackupError(
                `The backup failed, so nothing was restored${why}`,
              );
              return false;
            },
          );
        if (!made) return;
        setBackedUpFor(target);
      }
      // As mutate() does: a failure shows from restoreMutation's own state.
      await restoreMutation.mutateAsync({ id: target.id }).catch(() => {});
    } finally {
      setRestoring(false);
    }
  };
  const cancel = () => {
    // A failure belongs to this attempt, not the next dialog.
    restoreMutation.reset();
    setBackupError(null);
    setRestoreTarget(null);
    setRestoreConfirmText("");
  };
  return (
    <Modal
      onClose={cancel}
      label="Restore Version"
      busy={restoring}
      closeOnBackdrop={false}
      className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl"
    >
      <h3 className="text-primary mb-2 text-lg font-semibold">
        Restore Version
      </h3>
      <ReplacesNote className="mb-3">
        with the data from <strong>&ldquo;{restoreTarget.name}&rdquo;</strong>.
        This action cannot be undone unless you create a backup first.
      </ReplacesNote>

      <DataLossWarning tables={restoreDataLoss} />

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
        <label
          htmlFor={`${id}-confirm`}
          className="text-secondary mb-1 block text-sm font-medium"
        >
          Type the version name to confirm:
        </label>
        <input
          id={`${id}-confirm`}
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
          disabled={restoreConfirmText !== restoreTarget.name || restoring}
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {restoring ? "Restoring..." : "Restore"}
        </button>
        <ModalCancel>
          <button className="text-muted bg-surface-elevated hover:bg-surface-strong rounded px-3 py-1.5 text-xs font-medium">
            Cancel
          </button>
        </ModalCancel>
      </div>
      {backupError && (
        <p className="mt-2 text-xs text-red-600">{backupError}</p>
      )}
      {restoreMutation.isError && (
        <p className="mt-2 text-xs text-red-600">
          {restoreMutation.error.message}
        </p>
      )}
    </Modal>
  );
}
