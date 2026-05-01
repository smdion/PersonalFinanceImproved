"use client";

/**
 * Left-rail profile picker for the budget page master-detail layout.
 * Extracted from `src/app/(dashboard)/budget/page.tsx` during the v0.5.2
 * file-split refactor. Pure relocation — no behavior changes.
 *
 * Parent owns: profile list query, rename state (for the inline input),
 * tRPC mutations (set-active, create, rename, delete), and permission
 * gating. This component is purely presentational: it renders the list
 * and wires click / keyboard / hover controls back up through callbacks.
 */

import { formatCurrency } from "@/lib/utils/format";
import { confirm, promptText } from "@/components/ui/confirm-dialog";
import type { BudgetProfileListEntry } from "./types";

type Props = {
  profiles: BudgetProfileListEntry[];
  displayProfileId: number | null;
  canEdit: boolean;

  // Inline rename state (hoisted to parent so Escape/Blur flow stays simple)
  renamingProfileId: number | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: (profileId: number, currentName: string) => void;
  onFinishRename: (profileId: number, currentName: string) => void;
  onCancelRename: () => void;

  // API link badge
  apiService: string | null | undefined;
  apiLinkedProfileId: number | null;
  apiLinkedColumnIndex: number;

  // Callbacks
  onSelectProfile: (profileId: number) => void;
  onCreateProfile: (name: string) => void;
  onSetActiveProfile: (profileId: number) => void;
  onDeleteProfile: (profileId: number) => void;
};

export function BudgetProfileSidebar({
  profiles,
  displayProfileId,
  canEdit,
  renamingProfileId,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onFinishRename,
  onCancelRename,
  apiService,
  apiLinkedProfileId,
  apiLinkedColumnIndex,
  onSelectProfile,
  onCreateProfile,
  onSetActiveProfile,
  onDeleteProfile,
}: Props) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          Profiles
        </h3>
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              const name = await promptText(
                "New budget profile name:",
                "e.g. Aggressive Savings",
              );
              if (name) onCreateProfile(name);
            }}
            className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
          >
            + New
          </button>
        )}
      </div>
      {profiles.map((p) => {
        const isViewing = p.id === displayProfileId;
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectProfile(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectProfile(p.id);
              }
            }}
            className={`w-full text-left px-3 py-2 rounded-md transition-colors group cursor-pointer ${
              isViewing
                ? "bg-blue-50 border border-blue-300"
                : "hover:bg-surface-sunken border border-transparent"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                {renamingProfileId === p.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => onRenameValueChange(e.target.value)}
                    onBlur={() => onFinishRename(p.id, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") onCancelRename();
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-medium text-primary bg-surface-primary border border-strong rounded px-1 py-0.5 w-full"
                  />
                ) : (
                  <span className="text-xs font-medium text-primary truncate">
                    {p.name}
                  </span>
                )}
                {p.isActive && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold shrink-0">
                    ACTIVE
                  </span>
                )}
                {apiService && apiLinkedProfileId === p.id && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold shrink-0">
                    ⇄ {apiService.toUpperCase()} →{" "}
                    {(p.columnLabels as string[])?.[apiLinkedColumnIndex] ??
                      "Mode" + apiLinkedColumnIndex}
                  </span>
                )}
              </div>
              {canEdit && renamingProfileId !== p.id && (
                <div
                  className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!p.isActive && (
                    <button
                      type="button"
                      onClick={() => onSetActiveProfile(p.id)}
                      className="text-[10px] text-faint hover:text-green-600"
                    >
                      activate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onStartRename(p.id, p.name)}
                    className="text-[10px] text-faint hover:text-blue-600"
                  >
                    edit
                  </button>
                  {!p.isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirm(`Delete profile"${p.name}"?`)) {
                          onDeleteProfile(p.id);
                        }
                      }}
                      className="text-[10px] text-faint hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-muted">
              <span>{formatCurrency(p.annualTotal)}/yr</span>
              <span>
                {p.columnCount} mode{p.columnCount !== 1 ? "s" : ""}
                {(p.columnMonths as number[] | null) ? " (weighted)" : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
