"use client";

import { useState } from "react";
import { FormError } from "@/components/ui/form-error";

type AddCategoryFormProps = {
  onCreateCategory: (categoryName: string) => void;
};

export function AddCategoryForm({ onCreateCategory }: AddCategoryFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!showForm) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setShowForm(true)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          + New Category
        </button>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      setValidationError("Category name is required");
      return;
    }
    setValidationError(null);
    onCreateCategory(name.trim());
    setShowForm(false);
    setName("");
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setValidationError(null);
          }}
          placeholder="Category name..."
          className={`border rounded px-2 py-1 text-xs ${validationError ? "border-red-400" : ""}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            } else if (e.key === "Escape") {
              setShowForm(false);
              setName("");
              setValidationError(null);
            }
          }}
        />
        <button
          onClick={handleSubmit}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
        >
          Create
        </button>
        <button
          onClick={() => {
            setShowForm(false);
            setName("");
            setValidationError(null);
          }}
          className="text-faint hover:text-secondary text-xs"
        >
          Cancel
        </button>
        <span className="text-[10px] text-faint">
          Creates the category — you&apos;ll then add items to it
        </span>
      </div>
      <FormError message={validationError} />
    </div>
  );
}
