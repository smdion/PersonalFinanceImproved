"use client";

/**
 * Multi-profile budget management page (client content).
 *
 * Owns: queries, mutations, local UI state, pageCtxValue, and the top-level
 * layout. Hook and component extractions:
 *   useBudgetPageState     — edit mode, drafts, resize, lazy-render
 *   useBudgetDerivedData   — contribs, category map, API actuals, getCatTotals
 *   BudgetDetailPanel      — right-side detail grid content
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  PROFILE_TABS,
  profilesHref,
  type ProfileTabKey,
} from "@/lib/config/profile-tabs";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission, isAdmin } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import {
  SK_ACTIVE_SALARY_PROFILE_ID,
  SK_ACTIVE_CONTRIB_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import {
  ContributionProfileManager,
  SalaryProfileManager,
  SavingsAllocationPanel,
} from "@/components/budget";
import type { ColumnResult } from "@/components/budget";
import { BudgetPushYnabModal } from "@/components/budget/budget-push-ynab-modal";
import { BudgetPullYnabModal } from "@/components/budget/budget-pull-ynab-modal";
import { BudgetSummaryBar } from "@/components/budget/budget-summary-bar";
import { ExtraPaycheckBudgetNote } from "@/components/budget/extra-paycheck-budget-note";
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
import { RetirementProfileTab } from "@/components/retirement/retirement-profile-tab";
import { RetirementProfileManager } from "@/components/retirement/retirement-profile-manager";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";

/**
 * The Budget page and the Profiles page share this body (one set of
 * queries and drafts): `section="budget"` is the budget grid with its
 * Budget-profile sidebar; `section="profiles"` is the Salary,
 * Contributions, Savings and Retirement profile managers plus the What-If
 * sandbox, with the tab in the URL (?tab=).
 */
export function BudgetContent({
  section = "budget",
}: {
  section?: "budget" | "profiles";
}) {
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
  const { data: allProfiles } = useBudgetProfilesList();
  const activeProfileId = allProfiles?.find((p) => p.isActive)?.id ?? null;
  const [viewingProfileId, setViewingProfileId] = useState<number | null>(null);
  // Single shared resolution for both the Budget tab and Savings tab — see
  // useEffectiveProfileId's docblock for why this must not be two independent calls.
  const { profileId: displayProfileId } = useEffectiveProfileId("budget", {
    validIds: allProfiles?.map((p) => p.id),
    localSelection: viewingProfileId,
    globalDefaultId: activeProfileId,
  });

  const [activeContribProfileId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  // [per-column profile] -> active contribution / salary profile.
  const [activeSalaryProfileIdSetting] = usePersistedSetting<number | null>(
    SK_ACTIVE_SALARY_PROFILE_ID,
    null,
  );
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  // One shared tier object per axis, fed to BOTH the server query and the
  // client-side per-column resolution so they cannot resolve differently.
  const contributionProfileTiers = useMemo(
    () => ({
      localSelectionId: null,
      globalDefaultId: activeContribProfileId,
    }),
    [activeContribProfileId],
  );
  const salaryProfileTiers = useMemo(
    () => ({
      localSelectionId: null,
      globalDefaultId: activeSalaryProfileIdSetting,
    }),
    [activeSalaryProfileIdSetting],
  );
  const { data, isLoading, error } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: activeColumn,
    contributionProfile: contributionProfileTiers,
    salaryProfile: salaryProfileTiers,
    ...(displayProfileId != null ? { profileId: displayProfileId } : {}),
  });
  const { data: apiActualsData } = trpc.budget.listApiActuals.useQuery(
    displayProfileId != null ? { profileId: displayProfileId } : undefined,
  );
  // Resolved per the profile being viewed (funding is entirely per-profile,
  // same path the Savings page uses) — NOT savings.savingsGoals.list,
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
  const {
    setActiveProfile,
    createProfile,
    deleteProfile,
    renameProfile,
    duplicateProfile,
  } = useProfileMutations();
  const { clone: cloneProfile } = useCloneProfile(duplicateProfile);
  const handleActivateBudgetProfile = (id: number) => {
    setActiveProfile.mutate({ id });
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
  // Profiles: the tab follows the URL (?tab=), so links and the back button
  // land on the right tab. Budget has one view.
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get("tab");
  const profileTab: ProfileTabKey =
    PROFILE_TABS.find((t) => t.key === urlTab)?.key ?? "salary";
  const activeTab = section === "budget" ? "budget" : profileTab;
  const setActiveTab = (tab: ProfileTabKey) =>
    router.replace(profilesHref(tab), { scroll: false });
  const [pushPreviewItems, setPushPreviewItems] = useState<ReturnType<
    typeof buildPushPreviewItems
  > | null>(null);
  const [pullPreviewItems, setPullPreviewItems] = useState<ReturnType<
    typeof buildPullPreviewItems
  > | null>(null);
  // Retirement tab's own "view without activating" selection — lifted here
  // (not owned by RetirementProfileManager or RetirementProfileTab
  // individually) so both halves of the master-detail layout agree on
  // which profile is being shown, same lifting pattern the other three
  // profile types' managers already use for their own list/detail split.
  const [viewingRetirementProfileId, setViewingRetirementProfileId] = useState<
    number | null
  >(null);
  // Resolved (not raw) — same computation RetirementProfileManager runs
  // internally for its own row highlighting (same inputs, shared query
  // cache, so the two can't disagree). RetirementProfileTab needs the
  // RESOLVED id, not the raw click state (null until something's clicked),
  // so the two columns always show the same profile.
  const { data: retirementProfilesForResolve } =
    trpc.retirement.retirementProfiles.list.useQuery();
  const [activeRetirementProfileId] = useActiveRetirementProfile();
  const { profileId: resolvedViewingRetirementProfileId } =
    useEffectiveProfileId("retirement", {
      validIds: (retirementProfilesForResolve ?? []).map((p) => p.id),
      localSelection: viewingRetirementProfileId,
      globalDefaultId: activeRetirementProfileId,
    });
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
  } = useBudgetPageState({
    data,
    nameColWidth,
    setNameColWidth,
    updateBatch,
    contributionProfileTiers,
  });

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
      <p className="text-sm text-red-600">
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
    matchContrib: (sub: string, colIdx?: number) => matchContrib(sub, colIdx),
    addingItemToCategory,
    onSetAddingItemToCategory: setAddingItemToCategory,
  };

  return (
    <BudgetPageContext.Provider value={pageCtxValue}>
      <div>
        {section === "budget" ? (
          <PageHeader
            title="Budget"
            subtitle={
              <>
                Spends the take-home pay your Salary and Contribution profiles
                produce; Savings allocates what&rsquo;s left.{" "}
                <Link
                  href="/profiles"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  Salary, Contribution, Savings and Retirement profiles
                </Link>{" "}
                have their own page.
              </>
            }
          >
            <EditLockToggle
              locked={!editMode}
              onToggle={toggleEditMode}
              disabled={!canEdit || updateBatch.isPending}
            />
          </PageHeader>
        ) : (
          <>
            <PageHeader
              title="Profiles"
              subtitle="Each profile is its own world — the header picks which one is active, and a Plan saves a set of them. Pick a profile here to edit it; Make active switches it everywhere."
            />
            {/* Ordered to match the dependency chain: Salary sets gross pay,
                Contributions (often % of salary) derive take-home, the Budget
                (its own page) spends it, Savings allocates what's left —
                see docs/RULES.md "Lever Order". Retirement consumes all of
                these, and What-If previews combinations of them, so they
                come last. */}
            <div className="mb-4 flex items-center justify-between border-b">
              <div role="tablist" className="flex gap-1 overflow-x-auto">
                {PROFILE_TABS.filter(
                  (t) => t.key !== "savings" || hasPermission(user, "savings"),
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`border-b-2 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${activeTab === t.key ? "border-blue-600 text-blue-600" : "text-muted hover:text-secondary border-transparent"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {/* One padlock for every profile tab (EDIT_LOCK_KEYS
                  .profileEditLocked) — locking any one locks them all.
                  What-If is a sandbox with nothing to lock. */}
              {activeTab !== "whatif" && (
                <EditLockToggle
                  locked={!editMode}
                  onToggle={toggleEditMode}
                  disabled={
                    activeTab === "savings"
                      ? !hasPermission(user, "savings")
                      : activeTab === "retirement"
                        ? !isAdmin(user)
                        : !hasPermission(user, "contributionProfile")
                  }
                />
              )}
            </div>
          </>
        )}

        {activeTab === "budget" && (
          <CardBoundary title="Budget Profiles">
            <BudgetSummaryBar
              profileDisplay={{
                profileName: profile?.name ?? null,
                activeProfileName: activeProfile?.name ?? null,
                isViewingNonActive,
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
                // Preview the column syncBudgetToApi will actually push
                // (the connection's configured linkedColumnIndex), not
                // necessarily the page's currently-viewed column — a
                // mismatch here would show one number and push another.
                onOpenPushPreview: () =>
                  setPushPreviewItems(
                    buildPushPreviewItems(apiLinkedColumnIndex ?? activeColumn),
                  ),
              }}
              unsavedCount={editDrafts.size}
              onToggleModeManager={() => setShowModeManager(!showModeManager)}
              isSavingBatch={updateBatch.isPending}
            />

            <ExtraPaycheckBudgetNote />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
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
                onRename={(id, name) => renameProfile.mutate({ id, name })}
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
                onCloneProfile={cloneProfile}
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
              />
            </div>
          </CardBoundary>
        )}

        {activeTab === "salary" && (
          <CardBoundary title="Salary Profiles">
            <SalaryProfileManager
              canEdit={hasPermission(user, "contributionProfile")}
              locked={!editMode}
            />
          </CardBoundary>
        )}

        {activeTab === "contributions" && (
          <CardBoundary title="Contribution Profiles">
            <ContributionProfileManager
              canEdit={hasPermission(user, "contributionProfile")}
              locked={!editMode}
            />
          </CardBoundary>
        )}

        {activeTab === "whatif" && (
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
              locked={!editMode}
              viewingProfileId={displayProfileId}
              onSelectProfile={setViewingProfileId}
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

        {activeTab === "retirement" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
            <RetirementProfileManager
              viewingProfileId={viewingRetirementProfileId}
              onViewingProfileChange={setViewingRetirementProfileId}
            />
            <RetirementProfileTab
              profileId={resolvedViewingRetirementProfileId}
            />
          </div>
        )}

        {pushPreviewItems && (
          <BudgetPushYnabModal
            items={pushPreviewItems}
            activeColumnLabel={cols[apiLinkedColumnIndex ?? activeColumn]}
            apiService={apiService}
            isPending={syncToApi.isPending}
            onConfirm={() =>
              syncToApi.mutate(undefined, {
                onSettled: () => setPushPreviewItems(null),
              })
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
