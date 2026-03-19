"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

type ApiCategoryPickerProps = {
  budgetItemId: number;
  currentApiCategoryId?: string | null;
  currentApiCategoryName?: string | null;
  currentSyncDirection?: "pull" | "push" | "both" | null;
  onClose: () => void;
};

export function ApiCategoryPicker({
  budgetItemId,
  currentApiCategoryId,
  currentApiCategoryName,
  currentSyncDirection,
  onClose,
}: ApiCategoryPickerProps) {
  const utils = trpc.useUtils();
  const { data } = trpc.budget.listApiCategories.useQuery();
  const linkMut = trpc.budget.linkToApi.useMutation({
    onSuccess: () => {
      utils.budget.getActiveSummary.invalidate();
      onClose();
    },
  });
  const unlinkMut = trpc.budget.unlinkFromApi.useMutation({
    onSuccess: () => {
      utils.budget.getActiveSummary.invalidate();
      onClose();
    },
  });

  const [syncDirection, setSyncDirection] = useState<"pull" | "push" | "both">(
    currentSyncDirection ?? "pull",
  );
  const [search, setSearch] = useState("");

  const groups = data?.groups ?? [];
  const filtered = search
    ? groups
        .map((g) => ({
          ...g,
          categories: g.categories.filter((c) =>
            c.name.toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((g) => g.categories.length > 0)
    : groups;

  return (
    <div className="absolute z-50 bg-surface-primary border rounded-lg shadow-lg p-3 w-72 max-h-80 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted">
          Link to API Category
        </span>
        <button
          onClick={onClose}
          className="text-faint hover:text-secondary text-xs"
        >
          Close
        </button>
      </div>

      {currentApiCategoryId && (
        <div className="mb-2 p-2 bg-blue-50 rounded text-xs">
          <div className="flex items-center justify-between">
            <span className="text-blue-700">
              Linked: {currentApiCategoryName}
            </span>
            <button
              onClick={() => unlinkMut.mutate({ budgetItemId })}
              disabled={unlinkMut.isPending}
              className="text-red-500 hover:text-red-700 text-[10px]"
            >
              Unlink
            </button>
          </div>
        </div>
      )}

      <div className="mb-2">
        <select
          value={syncDirection}
          onChange={(e) =>
            setSyncDirection(e.target.value as "pull" | "push" | "both")
          }
          className="w-full text-[10px] border rounded px-1.5 py-1"
        >
          <option value="pull">Pull (API is master)</option>
          <option value="push">Push (Ledgr is master)</option>
          <option value="both">Both (last writer wins)</option>
        </select>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search categories..."
        className="w-full text-xs border rounded px-2 py-1 mb-2"
        autoFocus
      />

      {filtered.length === 0 && (
        <p className="text-xs text-faint text-center py-4">
          No categories. Sync budget API first.
        </p>
      )}

      {filtered.map((group) => (
        <div key={group.id} className="mb-1">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1 py-0.5">
            {group.name}
          </div>
          {group.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                linkMut.mutate({
                  budgetItemId,
                  apiCategoryId: cat.id,
                  apiCategoryName: `${group.name}: ${cat.name}`,
                  syncDirection,
                })
              }
              disabled={linkMut.isPending}
              className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-blue-50 transition-colors ${
                cat.id === currentApiCategoryId
                  ? "bg-blue-50 text-blue-700"
                  : "text-secondary"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
