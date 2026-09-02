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
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { Badge } from "@/components/ui/badge";
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
      <ProfileSidebarHeader
        onCreate={
          canEdit
            ? async () => {
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
              }
            : undefined
        }
      />
      {profiles.map((p) => {
        const isViewing = p.id === displayProfileId;
        const isRenamingThis = renamingProfileId === p.id;
        return (
          <ProfileListRow
            key={p.id}
            name={p.name}
            isSelected={isViewing}
            isActive={p.isActive}
            onSelect={() => onSelectProfile(p.id)}
            isRenaming={isRenamingThis}
            renameValue={renameValue}
            onRenameValueChange={onRenameValueChange}
            onRenameComplete={() => onFinishRename(p.id, p.name)}
            onRenameCancel={onCancelRename}
            onStartRename={
              canEdit ? () => onStartRename(p.id, p.name) : undefined
            }
            onActivate={
              canEdit && !p.isActive
                ? () => onSetActiveProfile(p.id)
                : undefined
            }
            onClone={canEdit ? () => onCloneProfile(p.id, p.name) : undefined}
            onDelete={
              canEdit && !p.isActive
                ? async () => {
                    const pinnedBy = pinningPlanNames(p.id);
                    // "active" not "pin/pinned" in user-facing text (RULES.md).
                    const pinnedByClause =
                      pinnedBy.length > 0
                        ? ` The Plan${pinnedBy.length > 1 ? "s" : ""} "${pinnedBy.join('", "')}" ${pinnedBy.length > 1 ? "have" : "has"} this profile active and will fall back to the household's active profile once it's gone.`
                        : "";
                    if (
                      await confirm(
                        `Delete profile "${p.name}"? Its budget items and any savings allocations customized for this profile will be permanently deleted too.${pinnedByClause}`,
                      )
                    ) {
                      onDeleteProfile(p.id);
                    }
                  }
                : undefined
            }
            extraBadge={
              apiService && apiLinkedProfileId === p.id ? (
                <Badge color="blue" case="normal" className="shrink-0">
                  ⇄ {apiService.toUpperCase()} →{" "}
                  {(p.columnLabels as string[])?.[apiLinkedColumnIndex] ??
                    "Mode" + apiLinkedColumnIndex}
                </Badge>
              ) : undefined
            }
            meta={
              <>
                <span>{formatCurrency(p.annualTotal)}/yr</span>
                <span>
                  {p.columnCount} mode{p.columnCount !== 1 ? "s" : ""}
                  {(p.columnMonths as number[] | null) ? " (weighted)" : ""}
                </span>
              </>
            }
          />
        );
      })}
    </div>
  );
}
