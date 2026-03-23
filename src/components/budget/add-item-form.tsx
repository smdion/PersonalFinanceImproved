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
          className={`border rounded px-2 py-1 text-xs flex-1 max-w-[200px] ${validationError ? "border-red-400" : ""}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
        />
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input
            type="checkbox"
            checked={isEssential}
            onChange={(e) => setIsEssential(e.target.checked)}
            className="w-3 h-3"
          />
          Essential
        </label>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] hover:bg-blue-700 disabled:opacity-50"
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
      <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs font-medium text-blue-800 mb-2">
          New category: <span className="font-bold">{category}</span>
        </p>
        {formContent}
      </div>
    );
  }

  return (
    <tr className="bg-blue-50 border-b border-blue-200">
      <td colSpan={numCols + 1} className="py-2 px-4">
        {formContent}
      </td>
    </tr>
  );
}
