"use client";

/**
 * Left-rail profile picker for the budget page master-detail layout.
 *
 * Parent owns: profile list query, tRPC mutations (set-active, create,
 * rename, delete), and permission gating. This component is purely
 * presentational: it renders the list and wires click / keyboard controls
 * back up through callbacks. Rename is a click-to-edit on the row name
 * (shared `ProfileListRow` behavior) — one `onRename` callback.
 */

import { budgetApiServiceLabel, formatCurrency } from "@/lib/utils/format";
import { confirm, promptText } from "@/components/ui/confirm-dialog";
import { usePlanNamesUsing } from "@/lib/hooks/use-plans";
import { planInUseMessage } from "@/lib/pure/plans";
import { toast } from "@/lib/hooks/use-toast";
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
  /** Rename a profile (click-to-edit on the row name). Called with the
   *  trimmed new name only when it changed. */
  onRename: (profileId: number, newName: string) => void;

  // API link badge
  apiService: string | null | undefined;
  apiLinkedProfileId: number | null;
  apiLinkedColumnIndex: number;

  // Callbacks
  onSelectProfile: (profileId: number) => void;
  onCreateProfile: (name: string) => void;
  onSetActiveProfile: (profileId: number) => void;
  onDeleteProfile: (profileId: number) => void;
  onCloneProfile: (profileId: number, currentName: string) => void;
};

export function BudgetProfileSidebar({
  profiles,
  displayProfileId,
  canEdit,
  onRename,
  apiService,
  apiLinkedProfileId,
  apiLinkedColumnIndex,
  onSelectProfile,
  onCreateProfile,
  onSetActiveProfile,
  onDeleteProfile,
  onCloneProfile,
}: Props) {
  const planNamesUsing = usePlanNamesUsing();

  return (
    <div className="space-y-1.5">
      <ProfileSidebarHeader
        onCreate={
          canEdit
            ? async () => {
                const name = await promptText(
                  "New budget profile name:",
                  "e.g. Aggressive Savings",
                );
                if (name) onCreateProfile(name);
              }
            : undefined
        }
      />
      {profiles.map((p) => {
        const isViewing = p.id === displayProfileId;
        return (
          <ProfileListRow
            key={p.id}
            name={p.name}
            isSelected={isViewing}
            isActive={p.isActive}
            onSelect={() => onSelectProfile(p.id)}
            onRename={canEdit ? (name) => onRename(p.id, name) : undefined}
            onActivate={
              canEdit && !p.isActive
                ? () => onSetActiveProfile(p.id)
                : undefined
            }
            onClone={canEdit ? () => onCloneProfile(p.id, p.name) : undefined}
            onDelete={
              canEdit && !p.isActive
                ? async () => {
                    const usedBy = planNamesUsing("budget", p.id);
                    if (usedBy.length > 0) {
                      toast.error(planInUseMessage("budget", usedBy));
                      return;
                    }
                    if (
                      await confirm(
                        `Delete profile "${p.name}"? Its budget items and any savings allocations set for this profile will be permanently deleted too.`,
                      )
                    ) {
                      onDeleteProfile(p.id);
                    }
                  }
                : undefined
            }
            metaTag={
              apiService && apiLinkedProfileId === p.id
                ? (() => {
                    const mode =
                      (p.columnLabels as string[])?.[apiLinkedColumnIndex] ??
                      `Mode ${apiLinkedColumnIndex}`;
                    return (
                      <Badge
                        color="blue"
                        case="normal"
                        subtle
                        className="shrink-0"
                        title={`This profile's "${mode}" mode two-way syncs with ${budgetApiServiceLabel(apiService as "ynab" | "actual")}`}
                      >
                        ⇄{" "}
                        {budgetApiServiceLabel(apiService as "ynab" | "actual")}{" "}
                        → {mode}
                      </Badge>
                    );
                  })()
                : undefined
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
