import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";

/**
 * Create-new panel, the one batch form: a profile row must exist before job
 * entries can go in it. Starts empty; jobs are added in ProfileEditPanel.
 */
export function ProfileCreatePanel({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (newId?: number) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.salaryProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
    onError: (e) => setError(e.message),
  });

  const handleCreate = () => {
    createMutation.mutate({
      name,
      description: description || undefined,
    });
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="flex items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Name">
            <FormInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Promotion"
            />
          </FormField>
          <FormField label="Description">
            <FormInput
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </FormField>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-muted hover:text-secondary px-2 py-1.5 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
      <p className="text-caption text-faint mt-3">
        Starts completely empty — add jobs to it after creating.
      </p>
    </div>
  );
}
