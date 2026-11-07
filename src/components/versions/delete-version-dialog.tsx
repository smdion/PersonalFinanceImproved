"use client";

/** The confirmation before a saved version is deleted. */

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type DeleteVersionDialogProps = {
  deleteTarget: number | null;
  handleDelete: (id: number) => void;
  deleteMutation: { isPending: boolean };
  setDeleteTarget: (target: null) => void;
};

export function DeleteVersionDialog({
  deleteTarget,
  handleDelete,
  deleteMutation,
  setDeleteTarget,
}: DeleteVersionDialogProps) {
  if (deleteTarget === null) return null;
  return (
    <Modal
      onClose={() => setDeleteTarget(null)}
      label="Delete Version"
      closeOnBackdrop={false}
      className="bg-surface-primary mx-4 w-full max-w-sm rounded-lg p-6 shadow-xl"
    >
      <h3 className="text-primary mb-2 text-lg font-semibold">
        Delete Version
      </h3>
      <p className="text-muted mb-4 text-sm">
        Are you sure you want to permanently delete this version? This cannot be
        undone.
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
    </Modal>
  );
}
