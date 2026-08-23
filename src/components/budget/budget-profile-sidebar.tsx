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
import { confirm, promptTextWithSelect } from "@/components/ui/confirm-dialog";
import { useScenario } from "@/lib/context/scenario-context";
import type { BudgetProfileListEntry } from "./types";

type Props = {
  profiles: BudgetProfileListEntry[];
  displayProfileId: number | null;
  canEdit: boolean;
  /** For "base the new profile off of this Contribution Profile" at
   *  creation time. */
  contribProfiles: { id: number; name: string }[];

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
  onCreateProfile: (name: string, contributionProfileId: number | null) => void;
  onSetActiveProfile: (profileId: number) => void;
  onDeleteProfile: (profileId: number) => void;
  onCloneProfile: (profileId: number, currentName: string) => void;
};

export function BudgetProfileSidebar({
  profiles,
  displayProfileId,
  canEdit,
  contribProfiles,
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
  onCloneProfile,
}: Props) {
  const { persistedScenarios } = useScenario();

  const pinningPlanNames = (profileId: number): string[] =>
    persistedScenarios
      .filter((s) => s.budgetProfileId === profileId)
      .map((s) => s.name);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-label font-semibold text-muted uppercase tracking-wide">
          Profiles
        </h3>
        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              const result = await promptTextWithSelect(
                "New budget profile name:",
                "e.g. Aggressive Savings",
                "Base it off of a Contribution Profile (optional)",
                contribProfiles.map((p) => ({
                  value: String(p.id),
                  label: p.name,
                })),
              );
              if (result) {
                onCreateProfile(
                  result.text,
                  result.selectValue ? Number(result.selectValue) : null,
                );
              }
            }}
            className="text-caption font-medium text-blue-600 hover:text-blue-700"
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
                  <span className="text-micro px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold shrink-0">
                    ACTIVE
                  </span>
                )}
                {apiService && apiLinkedProfileId === p.id && (
                  <span className="text-micro px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold shrink-0">
                    ⇄ {apiService.toUpperCase()} →{" "}
                    {(p.columnLabels as string[])?.[apiLinkedColumnIndex] ??
                      "Mode" + apiLinkedColumnIndex}
                  </span>
                )}
              </div>
              {canEdit && renamingProfileId !== p.id && (
                <div
                  className="flex gap-1 shrink-0 md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[12rem] md:group-hover:opacity-100 transition-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!p.isActive && (
                    <button
                      type="button"
                      onClick={() => onSetActiveProfile(p.id)}
                      className="text-caption text-faint hover:text-green-600"
                    >
                      activate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onStartRename(p.id, p.name)}
                    className="text-caption text-faint hover:text-blue-600"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onCloneProfile(p.id, p.name)}
                    className="text-caption text-faint hover:text-blue-600"
                  >
                    clone
                  </button>
                  {!p.isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        const pinnedBy = pinningPlanNames(p.id);
                        const pinnedByClause =
                          pinnedBy.length > 0
                            ? ` The Plan${pinnedBy.length > 1 ? "s" : ""} "${pinnedBy.join('", "')}" pin${pinnedBy.length > 1 ? "" : "s"} this profile and will fall back to the active profile once it's gone.`
                            : "";
                        if (
                          await confirm(
                            `Delete profile "${p.name}"? Its budget items and any savings allocations customized for this profile will be permanently deleted too.${pinnedByClause}`,
                          )
                        ) {
                          onDeleteProfile(p.id);
                        }
                      }}
                      className="text-caption text-faint hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-1 text-caption text-muted">
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
