"use client";

/**
 * Active budget summary bar — extracted from
 * `src/app/(dashboard)/budget/page.tsx` during the v0.5.2 file-split
 * refactor. Pure relocation of the JSX block above the master-detail grid:
 * displays the active (or viewing-only) profile name, API link badge,
 * current mode / weighted label, total, and the cluster of right-aligned
 * action buttons (Manage Modes, Pull, Push). The edit padlock lives in the
 * right column (BudgetDetailPanel), matching the other three profile tabs.
 *
 * The parent owns all state + tRPC mutations. This component receives
 * plain primitive props and event callbacks — no queries, no mutations,
 * no data-shape narrowing. Prop types are hand-rolled (no `@/server/*`
 * imports) per eslint.config.mjs no-restricted-imports rule.
 *
 * F3 (v0.5.3): stable per-context values consumed from BudgetPageContext.
 * Remaining props grouped into bundles. Props: 27 → 8.
 */

import { formatCurrency } from "@/lib/utils/format";
import { FormError } from "@/components/ui/form-error";
import { useBudgetPageContext } from "./budget-page-context";
import { computeTotalSinking, computeUnallocated } from "./helpers";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { Badge } from "@/components/ui/badge";
import type { ColumnResult, PayrollBreakdown, SinkingFundLine } from "./types";

type Props = {
  // Profile display data (not in context — changes when viewing non-active)
  profileDisplay: {
    profileName: string | null | undefined;
    activeProfileName: string | null | undefined;
    isViewingNonActive: boolean;
    isPinned?: boolean;
    onActivate?: () => void;
  };
  // Column display data (not in context — derived from server query result)
  columnDisplay: {
    isWeighted: boolean;
    columnMonths: number[] | null;
    allColumnResults: ColumnResult[] | null | undefined;
    payrollBreakdowns: (PayrollBreakdown | null)[];
    sinkingFunds: SinkingFundLine[];
  };
  // Mutation errors (structural shape for FormError)
  syncErrors: {
    saveError: { message: string } | null;
    pullError: { message: string } | null;
    pushError: { message: string } | null;
  };
  // Sync action state + callbacks
  syncActions: {
    isPulling: boolean;
    isPushing: boolean;
    onPullFromApi: () => void;
    onOpenPushPreview: () => void;
  };
  unsavedCount: number;
  onToggleModeManager: () => void;
  isSavingBatch: boolean;
};

export function BudgetSummaryBar({
  profileDisplay,
  columnDisplay,
  syncErrors,
  syncActions,
  unsavedCount,
  onToggleModeManager,
  isSavingBatch,
}: Props) {
  const {
    profileId,
    cols,
    activeColumn,
    apiService,
    apiLinkedProfileId,
    apiLinkedColumnIndex,
    canEdit,
    editMode,
  } = useBudgetPageContext();
  const {
    profileName,
    activeProfileName,
    isViewingNonActive,
    isPinned,
    onActivate,
  } = profileDisplay;
  const {
    isWeighted,
    columnMonths,
    allColumnResults,
    payrollBreakdowns,
    sinkingFunds,
  } = columnDisplay;
  const totalSinking = computeTotalSinking(sinkingFunds);
  const activeResult = allColumnResults?.[activeColumn];
  const unallocated =
    activeResult && !isWeighted
      ? computeUnallocated(
          payrollBreakdowns[activeColumn]?.netMonthly ?? 0,
          activeResult.totalMonthly,
          totalSinking,
        )
      : null;
  const { saveError, pullError, pushError } = syncErrors;
  const { isPulling, isPushing, onPullFromApi, onOpenPushPreview } =
    syncActions;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-sunken rounded-lg px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-2">
          <ProfileViewingBadge
            profileName={profileName}
            activeProfileName={activeProfileName}
            isViewingNonActive={isViewingNonActive}
            isPinned={isPinned}
            onActivate={canEdit ? onActivate : undefined}
          />
          {apiService && apiLinkedProfileId === profileId && (
            <Badge color="blue" case="normal">
              ⇄ {apiService.toUpperCase()} →{" "}
              {apiLinkedColumnIndex != null
                ? (cols[apiLinkedColumnIndex] ?? "Unknown")
                : "Unknown"}
            </Badge>
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
              <span className="text-caption">
                ({columnMonths?.map((m, i) => `${m}mo ${cols[i]}`).join(" +")})
              </span>
            </span>
          )}
          {unallocated != null && (
            <span
              className="text-faint"
              title="Take-home pay minus budgeted expenses minus sinking funds — what's left unassigned this month"
            >
              Unallocated:{" "}
              <span
                className={`font-medium ${unallocated >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {formatCurrency(unallocated)}
                <span className="text-caption font-normal">/mo</span>
              </span>
            </span>
          )}
          {allColumnResults && (
            <span
              className="text-faint"
              title="Budgeted spending + savings allocations, annualized"
            >
              Total spending + savings:{" "}
              <span className="font-semibold text-secondary">
                {formatCurrency(
                  (isWeighted && columnMonths
                    ? allColumnResults.reduce(
                        (sum, r, i) =>
                          sum + r.totalMonthly * (columnMonths[i] ?? 0),
                        0,
                      )
                    : (allColumnResults[activeColumn]?.totalMonthly ?? 0) *
                      12) +
                    totalSinking * 12,
                )}
                <span className="text-caption text-faint font-normal">/yr</span>
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
            className="px-2 py-1 text-caption font-medium rounded bg-surface-strong text-muted hover:bg-surface-strong"
          >
            Manage Modes
          </button>
        )}
        {canEdit && apiService != null && apiLinkedProfileId === profileId && (
          <>
            <button
              type="button"
              onClick={onPullFromApi}
              disabled={isPulling}
              className="px-2 py-1 text-caption font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              title={`Pull linked amounts from ${apiService?.toUpperCase()} into"${cols[activeColumn]}" mode`}
            >
              {isPulling
                ? "Pulling…"
                : `Pull from ${apiService?.toUpperCase()}`}
            </button>
            <button
              type="button"
              onClick={onOpenPushPreview}
              disabled={isPushing}
              className="px-2 py-1 text-caption font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              title={`Push"${cols[activeColumn]}" mode amounts to ${apiService?.toUpperCase()}`}
            >
              {isPushing ? "Pushing…" : `Push to ${apiService?.toUpperCase()}`}
            </button>
          </>
        )}
        {canEdit &&
          apiService != null &&
          apiLinkedProfileId !== profileId &&
          apiLinkedProfileId != null && (
            <span
              className="text-caption text-amber-600"
              title="Sync buttons are only available on the API-linked profile"
            >
              Sync: linked to another profile
            </span>
          )}
        {isSavingBatch && (
          <span className="text-caption text-muted">Saving…</span>
        )}
      </div>
    </div>
  );
}
