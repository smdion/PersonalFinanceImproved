"use client";

/**
 * Active budget summary bar — extracted from
 * `src/app/(dashboard)/budget/page.tsx` during the v0.5.2 file-split
 * refactor. Pure relocation of the JSX block above the master-detail grid:
 * displays the active (or viewing-only) profile name, API link badge,
 * current mode / weighted label, total, and the cluster of right-aligned
 * action buttons (Manage Modes, Pull, Push, Edit Mode / Save All).
 *
 * The parent owns all state + tRPC mutations. This component receives
 * plain primitive props and event callbacks — no queries, no mutations,
 * no data-shape narrowing. Prop types are hand-rolled (no `@/server/*`
 * imports) per eslint.config.mjs no-restricted-imports rule.
 */

import { formatCurrency } from "@/lib/utils/format";
import { FormError } from "@/components/ui/form-error";
import type { ColumnResult } from "./types";

type Props = {
  // Profile identity
  profileName: string | null | undefined;
  activeProfileName: string | null | undefined;
  isViewingNonActive: boolean;
  profileId: number | null | undefined;

  // API integration
  apiService: string | null | undefined;
  apiLinkedProfileId: number | null;
  apiLinkedColumnIndex: number;
  showApiColumn: boolean;

  // Columns + mode + totals
  cols: string[];
  activeColumn: number;
  isWeighted: boolean;
  columnMonths: number[] | null;
  allColumnResults: ColumnResult[] | null | undefined;

  // Permissions + edit state
  canEdit: boolean;
  editMode: boolean;
  unsavedCount: number;

  // Errors — structural shape matching FormError's `error` prop. Parent
  // passes through the tRPC mutation's `.error` field (nullable).
  saveError: { message: string } | null;
  pullError: { message: string } | null;
  pushError: { message: string } | null;

  // Mode manager toggle
  showModeManager: boolean;
  onToggleModeManager: () => void;

  // Sync actions
  isPulling: boolean;
  isPushing: boolean;
  onPullFromApi: () => void;
  onOpenPushPreview: () => void;

  // Edit toggle
  isSavingBatch: boolean;
  onToggleEditMode: () => void;
};

export function BudgetSummaryBar({
  profileName,
  activeProfileName,
  isViewingNonActive,
  profileId,
  apiService,
  apiLinkedProfileId,
  apiLinkedColumnIndex,
  showApiColumn,
  cols,
  activeColumn,
  isWeighted,
  columnMonths,
  allColumnResults,
  canEdit,
  editMode,
  unsavedCount,
  saveError,
  pullError,
  pushError,
  showModeManager,
  onToggleModeManager,
  isPulling,
  isPushing,
  onPullFromApi,
  onOpenPushPreview,
  isSavingBatch,
  onToggleEditMode,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-sunken rounded-lg px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-2">
          {isViewingNonActive ? (
            <>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-strong text-muted font-semibold uppercase">
                Viewing
              </span>
              <span className="text-xs text-muted">{profileName}</span>
              {activeProfileName && (
                <span className="text-[10px] text-faint">
                  (active: {activeProfileName})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold uppercase">
                Active
              </span>
              <span className="text-xs text-muted">{profileName}</span>
            </>
          )}
          {apiService && apiLinkedProfileId === profileId && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">
              ⇄ {apiService.toUpperCase()} →{" "}
              {cols[apiLinkedColumnIndex] ?? "Unknown"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          {cols.length > 0 && !isWeighted && (
            <span className="text-faint">
              Mode:{" "}
              <span className="font-medium text-secondary">
                {cols[activeColumn] ?? cols[0]}
              </span>
            </span>
          )}
          {isWeighted && (
            <span className="text-faint">
              Weighted{" "}
              <span className="text-[10px]">
                (
                {columnMonths
                  ?.map((m, i) => `${m}mo ${cols[i]}`)
                  .join(" +")}
                )
              </span>
            </span>
          )}
          {allColumnResults && (
            <span className="font-semibold text-secondary">
              {formatCurrency(
                isWeighted && columnMonths
                  ? allColumnResults.reduce(
                      (sum, r, i) =>
                        sum + r.totalMonthly * (columnMonths[i] ?? 0),
                      0,
                    )
                  : (allColumnResults[activeColumn]?.totalMonthly ?? 0) * 12,
              )}
              <span className="text-[10px] text-faint font-normal">
                /yr
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canEdit && editMode && unsavedCount > 0 && (
          <span className="text-xs text-amber-600">
            {unsavedCount} unsaved change
            {unsavedCount !== 1 ? "s" : ""}
          </span>
        )}
        {saveError && <FormError error={saveError} prefix="Save failed" />}
        {pullError && <FormError error={pullError} prefix="Pull failed" />}
        {pushError && <FormError error={pushError} prefix="Push failed" />}
        {canEdit && (
          <button
            type="button"
            onClick={onToggleModeManager}
            className="px-2 py-1 text-[10px] font-medium rounded bg-surface-strong text-muted hover:bg-surface-strong"
          >
            Manage Modes
          </button>
        )}
        {canEdit && showApiColumn && apiLinkedProfileId === profileId && (
          <>
            <button
              type="button"
              onClick={onPullFromApi}
              disabled={isPulling}
              className="px-2 py-1 text-[10px] font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              title={`Pull linked amounts from ${apiService?.toUpperCase()} into"${cols[activeColumn]}" mode`}
            >
              {isPulling ? "Pulling…" : `Pull from ${apiService?.toUpperCase()}`}
            </button>
            <button
              type="button"
              onClick={onOpenPushPreview}
              disabled={isPushing}
              className="px-2 py-1 text-[10px] font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              title={`Push"${cols[activeColumn]}" mode amounts to ${apiService?.toUpperCase()}`}
            >
              {isPushing ? "Pushing…" : `Push to ${apiService?.toUpperCase()}`}
            </button>
          </>
        )}
        {canEdit &&
          showApiColumn &&
          apiLinkedProfileId !== profileId &&
          apiLinkedProfileId != null && (
            <span
              className="text-[10px] text-amber-600"
              title="Sync buttons are only available on the API-linked profile"
            >
              Sync: linked to another profile
            </span>
          )}
        {canEdit && (
          <button
            type="button"
            onClick={onToggleEditMode}
            disabled={isSavingBatch}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
              editMode
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-surface-strong text-muted hover:bg-surface-strong"
            }`}
          >
            {isSavingBatch ? "Saving…" : editMode ? "Save All" : "Edit Mode"}
          </button>
        )}
      </div>
    </div>
  );
}
