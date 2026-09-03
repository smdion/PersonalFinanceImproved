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
      className="bg-surface-primary fixed z-50 max-h-80 w-72 overflow-y-auto rounded-lg border p-3 shadow-lg"
      style={{
        top: anchorRect.bottom + 4,
        left: Math.min(anchorRect.left, window.innerWidth - 300),
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted text-xs font-medium">
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
        <div className="mb-2 rounded bg-blue-50 p-2 text-xs">
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
              className="text-caption text-red-500 hover:text-red-700"
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
          className="text-caption w-full rounded border px-1.5 py-1"
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
        className="mb-2 w-full rounded border px-2 py-1 text-xs"
        autoFocus
      />

      {filtered.length === 0 && (
        <p className="text-faint py-4 text-center text-xs">
          No categories. Sync budget API first.
        </p>
      )}

      {filtered.map((group) => (
        <div key={group.id} className="mb-1">
          <div className="text-caption text-muted px-1 py-0.5 font-semibold tracking-wider uppercase">
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
              className={`w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-blue-50 ${
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
