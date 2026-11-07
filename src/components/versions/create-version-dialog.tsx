"use client";

/** The form that saves the household's data now as a named version. */

import type { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type CreateVersionDialogProps = {
  showCreateForm: boolean;
  createName: string;
  setCreateName: (name: string) => void;
  createDescription: string;
  setCreateDescription: (description: string) => void;
  handleCreate: () => void;
  createMutation: ReturnType<typeof trpc.version.create.useMutation>;
  setShowCreateForm: (show: boolean) => void;
};

export function CreateVersionDialog({
  showCreateForm,
  createName,
  setCreateName,
  createDescription,
  setCreateDescription,
  handleCreate,
  createMutation,
  setShowCreateForm,
}: CreateVersionDialogProps) {
  return (
    <>
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
    </>
  );
}
