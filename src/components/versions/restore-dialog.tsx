"use client";

/** The confirmation before a saved version replaces the household's data. */

import { useId, useState } from "react";
import type { trpc } from "@/lib/trpc";
import { localDateStr } from "@/lib/utils/date";
import { ReplacesNote } from "@/components/versions/replaces-note";
import { DataLossWarning } from "@/components/versions/restore-notices";
import { Modal } from "@/components/ui/modal";

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
  const id = useId();
  if (!restoreTarget) return null;
  const target = restoreTarget;
  const handleRestore = async () => {
    setRestoring(true);
    try {
      if (restoreCreateBackup) {
        await createMutation.mutateAsync({
          name: `Pre-restore backup (${localDateStr()})`,
          description: `Auto-created before restoring"${target.name}"`,
        });
      }
      // As mutate() does: a failure shows from restoreMutation's own state.
      await restoreMutation.mutateAsync({ id: target.id }).catch(() => {});
    } finally {
      setRestoring(false);
    }
  };
  const cancel = () => {
    setRestoreTarget(null);
    setRestoreConfirmText("");
  };
  return (
    <Modal
      onClose={cancel}
      label="Restore Version"
      closeOnEscape={!restoring}
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
        <button
          onClick={cancel}
          disabled={restoring}
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
    </Modal>
  );
}
