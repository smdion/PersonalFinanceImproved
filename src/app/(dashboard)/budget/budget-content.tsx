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
import { useUser, hasPermission, isAdmin } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { useScenario } from "@/lib/context/scenario-context";
import {
  ContributionProfileManager,
  SalaryProfileManager,
  SavingsAllocationPanel,
} from "@/components/budget";
import type { ColumnResult } from "@/components/budget";
import { BudgetPushYnabModal } from "@/components/budget/budget-push-ynab-modal";
import { BudgetPullYnabModal } from "@/components/budget/budget-pull-ynab-modal";
import { BudgetSummaryBar } from "@/components/budget/budget-summary-bar";
import { EditLockToggle } from "@/components/ui/edit-lock-toggle";
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
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useBudgetPageState } from "./use-budget-page-state";
import {
  useBudgetDerivedData,
  type SavingsGoalEntry,
} from "./use-budget-derived-data";
import { BudgetDetailPanel } from "./budget-detail-panel";
import { WhatIfTab } from "./what-if-tab";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";

export function BudgetContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "budget");
  const { isInScenario, setScenarioBudgetProfile } = useScenario();
  const [activeColumn, setActiveColumn] = usePersistedSetting<number>(
    "budget_active_column",
    0,
  );
  const [nameColWidth, setNameColWidth] = usePersistedSetting<number>(
    "budget_name_col_width",
    192,
  );

  // ---- Queries ----
  const { data: allProfiles } = useBudgetProfilesList();
  const activeProfileId = allProfiles?.find((p) => p.isActive)?.id ?? null;
  const [viewingProfileId, setViewingProfileId] = useState<number | null>(null);
  // Single shared resolution for both the Budget tab and Savings tab — see
  // useEffectiveProfileId's docblock for why this must not be two independent calls.
  const { profileId: displayProfileId, source: displayProfileSource } =
    useEffectiveProfileId("budget", {
      validIds: allProfiles?.map((p) => p.id),
      localSelection: viewingProfileId,
      globalDefaultId: activeProfileId,
    });
  const isPinnedProfile = displayProfileSource === "plan-pin";

  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  // Plan pin -> [per-column pin] -> globally-active contribution profile.
  // The Plan pin is kept as its OWN tier rather than pre-resolved into the
  // global-default slot — collapsing it there is what let a budget column's
  // pin beat an active Plan's pin (docs/RULES.md "Profile Pins").
  const { planPinId: planContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribProfileId,
    },
  );
  // Salary Profile — the independent second axis. Plan pin -> globally-active.
  const [activeSalaryProfileIdSetting] = usePersistedSetting<number | null>(
    SK_ACTIVE_SALARY_PROFILE_ID,
    null,
  );
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { planPinId: planSalaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeSalaryProfileIdSetting,
  });
  // One shared tier object per axis, fed to BOTH the server query and the
  // client-side per-column resolution so they cannot resolve differently.
  const contributionProfileTiers = useMemo(
    () => ({
      planPinId: planContribProfileId,
      localSelectionId: null,
      globalDefaultId: activeContribProfileId,
    }),
    [planContribProfileId, activeContribProfileId],
  );
  const salaryProfileTiers = useMemo(
    () => ({
      planPinId: planSalaryProfileId,
      localSelectionId: null,
      globalDefaultId: activeSalaryProfileIdSetting,
    }),
    [planSalaryProfileId, activeSalaryProfileIdSetting],
  );
  const salaryOverrides = useSalaryOverrides();
  const { data, isLoading, error } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: activeColumn,
    contributionProfile: contributionProfileTiers,
    salaryProfile: salaryProfileTiers,
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
  });
  const { data: apiActualsData } = trpc.budget.listApiActuals.useQuery(
    displayProfileId != null ? { profileId: displayProfileId } : undefined,
  );
  // Resolved per the profile being viewed (funding is entirely per-profile,
  // same path the Savings page uses) — NOT settings.savingsGoals.list,
  // which no longer carries funding data at all (goal identity only).
  const { data: resolvedSavingsGoals } =
    trpc.savings.goalProfileAllocations.list.useQuery(
      { profileId: displayProfileId! },
      { enabled: displayProfileId != null },
    );
  const savingsGoals: SavingsGoalEntry[] | undefined =
    resolvedSavingsGoals?.map((g) => ({
      id: g.goalId,
      name: g.name,
      isActive: true,
      monthlyContribution: g.monthlyContribution,
      allocationPercent: g.allocationPercent,
    }));

  // ---- Mutations ----
  const { setActiveProfile, createProfile, deleteProfile, renameProfile } =
    useProfileMutations();
  // While a Plan is selected, "activating" a profile pins it to that Plan
  // instead of changing the globally-active profile (which would affect
  // Main Plan and every other Plan too) — see docs/RULES.md "Profile Pins".
  const handleActivateBudgetProfile = (id: number) => {
    if (isInScenario) {
      setScenarioBudgetProfile(id);
    } else {
      setActiveProfile.mutate({ id });
    }
  };
  const {
    addColumn,
    removeColumn,
    renameColumn,
    updateColumnMonths,
    updateColumnContribProfiles,
    updateColumnSalaryProfiles,
  } = useColumnMutations();
  const { syncFromApi, syncToApi } = useSyncMutations();

  // selectedColumnRef lives here to break the circular dep between
  // useBudgetPageState (needs updateBatch) and useItemMutations (needs the ref).
  const selectedColumnRef = useRef(activeColumn);
  useEffect(() => {
    selectedColumnRef.current = activeColumn;
  }, [activeColumn]);

  const {
    deleteItem,
    updateItemEssential,
    updateCategoryEssential,
    updateBatch,
    moveItem,
    reorderItem,
    reorderCategory,
    createItem,
    convertToGoal,
  } = useItemMutations({ selectedColumnRef });

  // ---- Local UI state ----
  const [activeTab, setActiveTab] = useState<
    "budget" | "contributions" | "salary" | "savings" | "what-if"
  >("budget");
  const [pushPreviewItems, setPushPreviewItems] = useState<ReturnType<
    typeof buildPushPreviewItems
  > | null>(null);
  const [pullPreviewItems, setPullPreviewItems] = useState<ReturnType<
    typeof buildPullPreviewItems
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
    buildPullPreviewItems,
  } = useBudgetDerivedData({
    data,
    savingsGoals,
    apiActualsData,
    salaryOverrides,
    contributionProfileTiers,
    salaryProfileTiers,
    editMode,
    getDraft,
    visibleCount,
  });

  // ---- API actuals display values ----
  const showApiColumn = false;
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
    displayProfileSource === "user-selection" &&
    displayProfileId != null &&
    displayProfileId !== activeProfileId;

  const rowHandlers = {
    getDraft,
    setDraft,
    onToggleItemEssential: (id: number, isEssential: boolean) =>
      updateItemEssential.mutate({ id, isEssential }),
    onToggleCategoryEssential: (category: string, isEssential: boolean) =>
      updateCategoryEssential.mutate({
        category,
        isEssential,
        ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
      }),
    onMoveItem: (id: number, newCategory: string) =>
      moveItem.mutate({ id, newCategory }),
    onReorderItem: (id: number, direction: "up" | "down") =>
      reorderItem.mutate({ id, direction }),
    onReorderCategory: (category: string, direction: "up" | "down") =>
      reorderCategory.mutate({
        category,
        direction,
        ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
      }),
    onDeleteItem: (id: number) => deleteItem.mutate({ id }),
    onConvertToGoal: (id: number, name: string) =>
      convertToGoal.mutate({
        budgetItemId: id,
        goalName: name,
        targetMode: "ongoing",
      }),
    onAddItem: (category: string, subcategory: string, isEssential: boolean) =>
      createItem.mutate({
        category,
        subcategory,
        isEssential,
        ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
      }),
    addItemPending: createItem.isPending,
    addItemError: createItem.error,
    matchContrib: (sub: string) => matchContrib(sub),
    addingItemToCategory,
    onSetAddingItemToCategory: setAddingItemToCategory,
  };

  return (
    <BudgetPageContext.Provider value={pageCtxValue}>
      <div>
        <PageHeader
          title="Budget"
          subtitle={
            <>
              <div>
                Contributions set take-home pay, Budget spends it, Savings
                allocates what&rsquo;s left — in that order.
              </div>
              <div className="mt-0.5">
                Want to try a different profile without changing what&rsquo;s
                active for everyone? Use the &ldquo;Plan&rdquo; dropdown at the
                top of the page to create one, then pin profiles to it instead
                of activating them here — a Plan&rsquo;s pins only apply while
                you&rsquo;re viewing it, so the shared setup everyone else sees
                stays untouched.
              </div>
            </>
          }
        />

        {/* Ordered to match the actual dependency chain: Salary sets gross
            pay, Contributions (often % of salary) derive take-home,
            Budget spends it, which feeds Savings — see docs/RULES.md. */}
        <div className="flex gap-1 border-b mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("salary")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "salary" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            Salary Profiles
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("contributions")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "contributions" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            Contribution Profiles
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("budget")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "budget" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            Budget Profiles
          </button>
          {hasPermission(user, "savings") && (
            <button
              type="button"
              onClick={() => setActiveTab("savings")}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "savings" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
            >
              Savings Profiles
            </button>
          )}
          {/* Last, after the four real levers: it previews combinations of
              them rather than being a lever of its own. */}
          <button
            type="button"
            onClick={() => setActiveTab("what-if")}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "what-if" ? "border-blue-600 text-blue-600" : "border-transparent text-muted hover:text-secondary"}`}
          >
            What-If
          </button>
        </div>

        {activeTab === "budget" && (
          <CardBoundary title="Budget Profiles">
            <BudgetSummaryBar
              profileDisplay={{
                profileName: profile?.name ?? null,
                activeProfileName: activeProfile?.name ?? null,
                isViewingNonActive,
                isPinned: isPinnedProfile,
                onActivate:
                  profile?.id != null
                    ? () => handleActivateBudgetProfile(profile.id!)
                    : undefined,
              }}
              columnDisplay={{
                isWeighted,
                columnMonths,
                allColumnResults: allColumnResults as ColumnResult[] | null,
                payrollBreakdowns,
                sinkingFunds,
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
                  setPullPreviewItems(buildPullPreviewItems(activeColumn)),
                onOpenPushPreview: () =>
                  setPushPreviewItems(buildPushPreviewItems(activeColumn)),
              }}
              unsavedCount={editDrafts.size}
              onToggleModeManager={() => setShowModeManager(!showModeManager)}
              isSavingBatch={updateBatch.isPending}
            />

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
              <BudgetProfileSidebar
                profiles={(allProfiles ?? []) as BudgetProfileListEntry[]}
                displayProfileId={displayProfileId}
                canEdit={canEdit}
                contribProfiles={
                  (contribProfiles ?? []) as Array<{
                    id: number;
                    name: string;
                  }>
                }
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
                onCreateProfile={(name, contributionProfileId) =>
                  createProfile.mutate({
                    name,
                    contributionProfileId,
                  })
                }
                onSetActiveProfile={handleActivateBudgetProfile}
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
                  }>
                }
                salaryProfiles={
                  (salaryProfiles ?? []) as Array<{ id: number; name: string }>
                }
                columnMutations={{
                  renameColumn,
                  removeColumn,
                  addColumn,
                  updateColumnContribProfiles,
                  updateColumnSalaryProfiles,
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
                lockToggle={
                  /* Locking (toggling while unlocked) still flushes any
                     pending draft amounts via the batch save — that is what
                     toggleEditMode has always done. */
                  <EditLockToggle
                    locked={!editMode}
                    onToggle={toggleEditMode}
                    disabled={!canEdit || updateBatch.isPending}
                  />
                }
              />
            </div>
          </CardBoundary>
        )}

        {activeTab === "salary" && (
          <CardBoundary title="Salary Profiles">
            <SalaryProfileManager
              canEdit={hasPermission(user, "contributionProfile")}
            />
          </CardBoundary>
        )}

        {activeTab === "contributions" && (
          <CardBoundary title="Contribution Profiles">
            <ContributionProfileManager
              canEdit={hasPermission(user, "contributionProfile")}
            />
          </CardBoundary>
        )}

        {activeTab === "what-if" && (
          <CardBoundary title="What-If">
            <WhatIfTab
              canDuplicateProfile={canEdit}
              // Creating a Plan is settings.scenarios.create — scenarioProcedure,
              // a different permission from the Budget page's own gate.
              canCreatePlan={hasPermission(user, "scenario")}
              // settings.deductions.create / settings.contributionAccounts
              // .create are adminProcedure — a stricter gate than either
              // permission above.
              canManagePaycheck={isAdmin(user)}
            />
          </CardBoundary>
        )}

        {activeTab === "savings" && hasPermission(user, "savings") && (
          <CardBoundary title="Savings Profiles">
            <SavingsAllocationPanel
              canEdit={hasPermission(user, "savings")}
              viewingProfileId={displayProfileId}
              onSelectProfile={setViewingProfileId}
              isPinned={isPinnedProfile}
              onActivateProfile={handleActivateBudgetProfile}
              livePoolEstimate={
                isWeighted && columnMonths && allColumnResults
                  ? allColumnResults.reduce(
                      (sum, r, i) =>
                        sum +
                        ((payrollBreakdowns[i]?.netMonthly ?? 0) -
                          r.totalMonthly) *
                          (columnMonths[i] ?? 0),
                      0,
                    ) / 12
                  : allColumnResults?.[activeColumn] != null
                    ? (payrollBreakdowns[activeColumn]?.netMonthly ?? 0) -
                      allColumnResults[activeColumn]!.totalMonthly
                    : null
              }
              livePoolColumnLabel={isWeighted ? "Blended" : cols[activeColumn]}
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

        {pullPreviewItems && (
          <BudgetPullYnabModal
            items={pullPreviewItems}
            activeColumnLabel={cols[activeColumn]}
            apiService={apiService}
            isPending={syncFromApi.isPending}
            onConfirm={() =>
              syncFromApi.mutate(
                { selectedColumn: activeColumn },
                { onSettled: () => setPullPreviewItems(null) },
              )
            }
            onCancel={() => setPullPreviewItems(null)}
          />
        )}
      </div>
    </BudgetPageContext.Provider>
  );
}
