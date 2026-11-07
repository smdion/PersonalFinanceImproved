"use client";

/** The form that saves the household's data now as a named version. */

import type { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type CreateVersionDialogProps = {
  showCreateForm: boolean;
  setShowCreateForm: (show: boolean) => void;
  createName: string;
  setCreateName: (name: string) => void;
  createDescription: string;
  setCreateDescription: (description: string) => void;
  handleCreate: () => void;
  createMutation: ReturnType<typeof trpc.version.create.useMutation>;
};

export function CreateVersionDialog({
  showCreateForm,
  setShowCreateForm,
  createName,
  setCreateName,
  createDescription,
  setCreateDescription,
  handleCreate,
  createMutation,
}: CreateVersionDialogProps) {
  if (!showCreateForm) return null;
  const cancelCreate = () => {
    setShowCreateForm(false);
    setCreateName("");
    setCreateDescription("");
  };
  return (
    <Modal
      onClose={cancelCreate}
      label="Create Version"
      closeOnBackdrop={false}
      className="bg-surface-primary mx-4 w-full max-w-md rounded-lg p-6 shadow-xl"
    >
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
          onClick={cancelCreate}
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
    </Modal>
  );
}
