"use client";

/**
 * Multi-profile budget management page (client content). v0.5.3 F4.
 *
 * Owns: queries, mutations, local UI state, pageCtxValue, and the top-level
 * layout. Hook and component extractions:
 *   useBudgetPageState     — edit mode, drafts, resize, lazy-render
 *   useBudgetDerivedData   — contribs, category map, API actuals, getCatTotals
 *   BudgetDetailPanel      — right-side detail grid content
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { ContributionProfileManager } from "@/components/budget";
import type { ColumnResult } from "@/components/budget";
import { BudgetPushYnabModal } from "@/components/budget/budget-push-ynab-modal";
import { BudgetSummaryBar } from "@/components/budget/budget-summary-bar";
import {
  BudgetProfileSidebar,
  type BudgetProfileListEntry,
} from "@/components/budget";
import { useProfileMutations } from "@/components/budget/hooks/use-profile-mutations";
import { useColumnMutations } from "@/components/budget/hooks/use-column-mutations";
import { useSyncMutations } from "@/components/budget/hooks/use-sync-mutations";
import { useItemMutations } from "@/components/budget/hooks/use-item-mutations";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import {
  BudgetPageContext,
  type BudgetPageContextValue,
} from "@/components/budget/budget-page-context";
import { useBudgetPageState } from "./use-budget-page-state";
import {
  useBudgetDerivedData,
  type SavingsGoalEntry,
} from "./use-budget-derived-data";
import { BudgetDetailPanel } from "./budget-detail-panel";

export function BudgetContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "budget");
  const [activeColumn, setActiveColumn] = usePersistedSetting<number>(
    "budget_active_column",
    0,
  );
  const [nameColWidth, setNameColWidth] = usePersistedSetting<number>(
    "budget_name_col_width",
    192,
  );

  // ---- Queries ----
  const { data: allProfiles } = trpc.budget.listProfiles.useQuery();
  const activeProfileId = allProfiles?.find((p) => p.isActive)?.id ?? null;
  const [viewingProfileId, setViewingProfileId] = useState<number | null>(null);
  const displayProfileId = viewingProfileId ?? activeProfileId;

  const { data, isLoading, error } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: activeColumn,
    ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
  });
  const { data: apiActualsData } = trpc.budget.listApiActuals.useQuery();
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: savingsGoals } = trpc.settings.savingsGoals.list.useQuery();

  // ---- Mutations ----
  const { setActiveProfile, createProfile, deleteProfile, renameProfile } =
    useProfileMutations();
  const {
    addColumn,
    removeColumn,
    renameColumn,
    updateColumnMonths,
    updateColumnContribProfiles,
  } = useColumnMutations();
  const { syncFromApi, syncToApi } = useSyncMutations();

  // selectedColumnRef lives here to break the circular dep between
  // useBudgetPageState (needs updateBatch) and useItemMutations (needs the ref).
  const selectedColumnRef = useRef(activeColumn);
  useEffect(() => {
    selectedColumnRef.current = activeColumn;
  }, [activeColumn]);

  const {
    updateCell,
    deleteItem,
    updateItemEssential,
    updateCategoryEssential,
    updateBatch,
    moveItem,
    createItem,
    convertToGoal,
  } = useItemMutations({ selectedColumnRef });

  // ---- Local UI state ----
  const [activeTab, setActiveTab] = useState<"budget" | "contributions">(
    "budget",
  );
  const [pushPreviewItems, setPushPreviewItems] = useState<ReturnType<
    typeof buildPushPreviewItems
  > | null>(null);
  const [renamingProfileId, setRenamingProfileId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [showModeManager, setShowModeManager] = useState(false);
  const [addingItemToCategory, setAddingItemToCategory] = useState<
    string | null
  >(null);

  // ---- Extracted hooks (all before early returns) ----
  const {
    editMode,
    setEditMode,
    editDrafts,
    getDraft,
    setDraft,
    toggleEditMode,
    sentinelRef,
    visibleCount,
    effectiveNameColWidth,
    onResizeStart,
  } = useBudgetPageState({ data, nameColWidth, setNameColWidth, updateBatch });

  const {
    profile,
    cols,
    columnMonths,
    isWeighted,
    payrollBreakdowns,
    matchContrib,
    allColumnResults,
    categoryMap,
    categoryNames,
    visibleCategories,
    hasMoreCategories,
    getCatTotals,
    sinkingFunds,
    apiActualsMap,
    buildPushPreviewItems,
  } = useBudgetDerivedData({
    data,
    savingsGoals: savingsGoals as SavingsGoalEntry[] | undefined,
    apiActualsData,
    salaryOverrides,
    activeContribProfileId,
    editMode,
    getDraft,
    visibleCount,
  });

  // ---- API actuals display values ----
  const showApiColumn = (apiActualsData?.actuals?.length ?? 0) > 0;
  const apiService = apiActualsData?.service ?? null;
  const apiLinkedProfileId = apiActualsData?.linkedProfileId ?? null;
  const apiLinkedColumnIndex = apiActualsData?.linkedColumnIndex ?? null;

  // ---- Page context (before early returns per rules-of-hooks) ----
  const pageCtxValue = useMemo<BudgetPageContextValue>(
    () => ({
      profileId: profile?.id ?? null,
      cols,
      activeColumn,
      apiService,
      apiLinkedProfileId,
      apiLinkedColumnIndex,
      showApiColumn,
      canEdit,
      editMode,
      setEditMode,
    }),
    [
      profile?.id,
      cols,
      activeColumn,
      apiService,
      apiLinkedProfileId,
      apiLinkedColumnIndex,
      showApiColumn,
      canEdit,
      editMode,
      setEditMode,
    ],
  );

  // ---- Loading / error / empty states ----
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/4" />
        <SkeletonChart height={256} />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load budget: {error.message}
      </p>
    );
  }
  if (!data?.result) {
    return (
      <div>
        <PageHeader title="Budget" />
        <p className="text-muted">
          No active budget profile. Create one in Settings.
        </p>
      </div>
    );
  }

  const activeProfile = allProfiles?.find((p) => p.isActive) ?? null;
  const isViewingNonActive =
    displayProfileId != null && displayProfileId !== activeProfileId;

  const rowHandlers = {
    getDraft,
    setDraft,
    onUpdateCell: (id: number, col: number, amt: number) =>
      updateCell.mutate({ id, colIndex: col, amount: amt }),
    onToggleItemEssential: (id: number, isEssential: boolean) =>
      updateItemEssential.mutate({ id, isEssential }),
    onToggleCategoryEssential: (category: string, isEssential: boolean) =>
      updateCategoryEssential.mutate({ category, isEssential }),
    onMoveItem: (id: number, newCategory: string) =>
      moveItem.mutate({ id, newCategory }),
    onDeleteItem: (id: number) => deleteItem.mutate({ id }),
    onConvertToGoal: (id: number, name: string) =>
      convertToGoal.mutate({
        budgetItemId: id,
        goalName: name,
        targetMode: "ongoing",
      }),
    onAddItem: (category: string, subcategory: string, isEssential: boolean) =>
      createItem.mutate({ category, subcategory, isEssential }),
    addItemPending: createItem.isPending,
    addItemError: createItem.error,
    matchContrib: (sub: string) => matchContrib(sub),
    addingItemToCategory,
    onSetAddingItemToCategory: setAddingItemToCategory,
  };

  return (
    <BudgetPageContext.Provider value={pageCtxValue}>
      <div>
        <PageHeader title="Budget" />

        <div className="flex gap-1 border-b mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("budget")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "budget" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            Budget Profiles
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("contributions")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "contributions" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            Contribution Profiles
          </button>
        </div>

        {activeTab === "budget" && (
          <CardBoundary title="Budget Profiles">
            <BudgetSummaryBar
              profileDisplay={{
                profileName: profile?.name ?? null,
                activeProfileName: activeProfile?.name ?? null,
                isViewingNonActive,
              }}
              columnDisplay={{
                isWeighted,
                columnMonths,
                allColumnResults: allColumnResults as ColumnResult[] | null,
              }}
              syncErrors={{
                saveError: updateBatch.error,
                pullError: syncFromApi.error,
                pushError: syncToApi.error,
              }}
              syncActions={{
                isPulling: syncFromApi.isPending,
                isPushing: syncToApi.isPending,
                onPullFromApi: () =>
                  syncFromApi.mutate({ selectedColumn: activeColumn }),
                onOpenPushPreview: () =>
                  setPushPreviewItems(buildPushPreviewItems(activeColumn)),
              }}
              unsavedCount={editDrafts.size}
              onToggleModeManager={() => setShowModeManager(!showModeManager)}
              isSavingBatch={updateBatch.isPending}
              onToggleEditMode={toggleEditMode}
            />

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
              <BudgetProfileSidebar
                profiles={(allProfiles ?? []) as BudgetProfileListEntry[]}
                displayProfileId={displayProfileId}
                canEdit={canEdit}
                renamingProfileId={renamingProfileId}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onStartRename={(id, name) => {
                  setRenamingProfileId(id);
                  setRenameValue(name);
                }}
                onFinishRename={(id, currentName) => {
                  if (renameValue.trim() && renameValue.trim() !== currentName)
                    renameProfile.mutate({ id, name: renameValue.trim() });
                  setRenamingProfileId(null);
                }}
                onCancelRename={() => setRenamingProfileId(null)}
                apiService={apiService}
                apiLinkedProfileId={apiLinkedProfileId}
                apiLinkedColumnIndex={apiLinkedColumnIndex ?? 0}
                onSelectProfile={setViewingProfileId}
                onCreateProfile={(name) => createProfile.mutate({ name })}
                onSetActiveProfile={(id) => setActiveProfile.mutate({ id })}
                onDeleteProfile={(id) => deleteProfile.mutate({ id })}
              />

              <BudgetDetailPanel
                showModeManager={showModeManager}
                isWeighted={isWeighted}
                allColumnResults={allColumnResults as ColumnResult[] | null}
                setActiveColumn={setActiveColumn}
                payrollBreakdowns={payrollBreakdowns}
                columnMonths={columnMonths}
                sinkingFunds={sinkingFunds}
                profile={profile}
                contribProfiles={
                  (contribProfiles ?? []) as Array<{
                    id: number;
                    name: string;
                    isDefault: boolean;
                  }>
                }
                columnMutations={{
                  renameColumn,
                  removeColumn,
                  addColumn,
                  updateColumnContribProfiles,
                  updateColumnMonths,
                }}
                layout={{ effectiveNameColWidth, onResizeStart, sentinelRef }}
                visibleCategories={visibleCategories}
                hasMoreCategories={hasMoreCategories}
                categoryNames={categoryNames}
                getCatTotals={getCatTotals}
                apiActualsMap={apiActualsMap}
                rowHandlers={rowHandlers}
                categoryMap={categoryMap}
                createItem={createItem}
              />
            </div>
          </CardBoundary>
        )}

        {activeTab === "contributions" && (
          <CardBoundary title="Contribution Profiles">
            <ContributionProfileManager
              canEdit={hasPermission(user, "contributionProfile")}
            />
          </CardBoundary>
        )}

        {pushPreviewItems && (
          <BudgetPushYnabModal
            items={pushPreviewItems}
            activeColumnLabel={cols[activeColumn]}
            apiService={apiService}
            isPending={syncToApi.isPending}
            onConfirm={() =>
              syncToApi.mutate(
                { selectedColumn: activeColumn },
                { onSettled: () => setPushPreviewItems(null) },
              )
            }
            onCancel={() => setPushPreviewItems(null)}
          />
        )}
      </div>
    </BudgetPageContext.Provider>
  );
}
