"use client";

import { useState } from "react";
import { FormError } from "@/components/ui/form-error";

type AddItemFormProps = {
  category: string;
  onAdd: (category: string, subcategory: string, isEssential: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
  /** When true, renders as a standalone block (for new categories not yet in the table). */
  standalone?: boolean;
  numCols?: number;
  /** Mutation error from the parent, displayed inline. */
  error?: { message: string } | null;
};

export function AddItemForm({
  category,
  onAdd,
  onCancel,
  isPending,
  standalone = false,
  numCols = 1,
  error,
}: AddItemFormProps) {
  const [name, setName] = useState("");
  const [isEssential, setIsEssential] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) {
      setValidationError("Item name is required");
      return;
    }
    setValidationError(null);
    onAdd(category, name.trim(), isEssential);
  };

  const formContent = (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setValidationError(null);
          }}
          placeholder={standalone ? "First item name..." : "Item name..."}
          className={`max-w-[200px] flex-1 rounded border px-2 py-1 text-xs ${validationError ? "border-red-400" : ""}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
        />
        <label className="text-caption text-muted flex items-center gap-1">
          <input
            type="checkbox"
            checked={isEssential}
            onChange={(e) => setIsEssential(e.target.checked)}
            className="h-3 w-3"
          />
          Essential
        </label>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="text-caption rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="text-faint hover:text-secondary text-xs"
        >
          Cancel
        </button>
      </div>
      <FormError message={validationError} />
      <FormError error={error} prefix="Failed to add item" />
    </div>
  );

  if (standalone) {
    return (
      <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="mb-2 text-xs font-medium text-blue-800">
          New category: <span className="font-bold">{category}</span>
        </p>
        {formContent}
      </div>
    );
  }

  return (
    <tr className="border-b border-blue-200 bg-blue-50">
      <td colSpan={numCols + 1} className="px-4 py-2">
        {formContent}
      </td>
    </tr>
  );
}
