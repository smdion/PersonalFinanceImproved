"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";

type ApiCategoryPickerProps = {
  budgetItemId: number;
  currentApiCategoryId?: string | null;
  currentApiCategoryName?: string | null;
  currentSyncDirection?: "pull" | "push" | "both" | null;
  anchorRect: DOMRect;
  onClose: () => void;
};

export function ApiCategoryPicker({
  budgetItemId,
  currentApiCategoryId,
  currentApiCategoryName,
  currentSyncDirection,
  anchorRect,
  onClose,
}: ApiCategoryPickerProps) {
  const utils = trpc.useUtils();
  const { data } = trpc.budget.listApiCategories.useQuery();
  // The main Budget page always links against the currently active service
  // (there's no per-service selector here, unlike the Integrations sync
  // page) — item.apiCategoryId/apiCategoryName are already resolved against
  // this same active service server-side (see budget.ts's computeActive*
  // read paths), so this is the correct, non-ambiguous service to write to.
  const { data: activeService } = trpc.sync.getActiveBudgetApi.useQuery();
  const linkMut = trpc.budget.linkToApi.useMutation({
    onSuccess: () => {
      utils.budget.computeActiveSummary.invalidate();
      onClose();
    },
  });
  const unlinkMut = trpc.budget.unlinkFromApi.useMutation({
    onSuccess: () => {
      utils.budget.computeActiveSummary.invalidate();
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

  return createPortal(
    <div
      className="fixed z-50 bg-surface-primary border rounded-lg shadow-lg p-3 w-72 max-h-80 overflow-y-auto"
      style={{
        top: anchorRect.bottom + 4,
        left: Math.min(anchorRect.left, window.innerWidth - 300),
      }}
    >
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
              onClick={() =>
                activeService &&
                activeService !== "none" &&
                unlinkMut.mutate({ budgetItemId, service: activeService })
              }
              disabled={
                unlinkMut.isPending ||
                !activeService ||
                activeService === "none"
              }
              className="text-red-500 hover:text-red-700 text-caption"
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
          className="w-full text-caption border rounded px-1.5 py-1"
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
          <div className="text-caption font-semibold text-muted uppercase tracking-wider px-1 py-0.5">
            {group.name}
          </div>
          {group.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                activeService &&
                activeService !== "none" &&
                linkMut.mutate({
                  budgetItemId,
                  service: activeService,
                  apiCategoryId: cat.id,
                  apiCategoryName: `${group.name}: ${cat.name}`,
                  syncDirection,
                })
              }
              disabled={
                linkMut.isPending || !activeService || activeService === "none"
              }
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
    </div>,
    document.body,
  );
}
