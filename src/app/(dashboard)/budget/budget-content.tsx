"use client";

/**
 * Multi-profile budget management page (client content).
 *
 * The default-export BudgetPage in budget/page.tsx is a thin server
 * component that prefetches the most expensive queries
 * (listProfiles + computeActiveSummary) before rendering this —
 * matching the portfolio + retirement content-split pattern extracted
 * in the v0.5.2 file-split refactor.
 *
 * This file owns:
 *   - tRPC queries + query-derived state
 *   - local UI state (tabs, edit mode, draft store, resize width)
 *   - useProfileMutations / useColumnMutations / useSyncMutations /
 *     useItemMutations — all four per-section mutation hooks
 *   - helper glue (saveAllDrafts, toggleEditMode, onResizeStart,
 *     matchContrib, getCatTotals)
 *
 * JSX rendering delegates to the extracted components:
 * BudgetSummaryBar, BudgetProfileSidebar, BudgetTable,
 * BudgetPushYnabModal, plus the pre-existing BudgetModeManager /
 * BudgetSummaryTable / AddItemForm / AddCategoryForm /
 * ContributionProfileManager.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { usePerColumnPaycheck } from "@/lib/hooks/use-per-column-paycheck";
import {
  BudgetModeManager,
  BudgetSummaryTable,
  AddItemForm,
  AddCategoryForm,
  ContributionProfileManager,
} from "@/components/budget";
import { BudgetTable } from "@/components/budget/budget-table";
import type {
  RawItem,
  PayrollBreakdown,
  ColumnResult,
  SinkingFundLine,
} from "@/components/budget";
import {
  buildPayrollBreakdown,
  buildNonPayrollContribs,
} from "@/components/budget/helpers";
import { normalizeContribKey } from "@/lib/config/account-types";
import { type PushPreviewItem } from "@/components/ui/push-preview-modal";
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
  const { data: allProfiles } = trpc.budget.listProfiles.useQuery();
  const activeProfileId = allProfiles?.find((p) => p.isActive)?.id ?? null;
  const [viewingProfileId, setViewingProfileId] = useState<number | null>(null);
  // Show the viewing profile if set, otherwise fall back to active
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

  // Local UI state
  const [activeTab, setActiveTab] = useState<"budget" | "contributions">(
    "budget",
  );
  const [pushPreviewItems, setPushPreviewItems] = useState<
    PushPreviewItem[] | null
  >(null);
  const [renamingProfileId, setRenamingProfileId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [showModeManager, setShowModeManager] = useState(false);
  const [addingItemToCategory, setAddingItemToCategory] = useState<
    string | null
  >(null);
  const [editDrafts, setEditDrafts] = useState<Map<string, number>>(new Map());

  // Live-read of activeColumn for the optimistic item mutations. The
  // mutations read from this ref in their onMutate handlers so a
  // column-switch mid-flight still targets the user's current view.
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

  // Lazy rendering for large budgets (prevents DOM bloat with 300+ rows)
  // All hooks must be declared before early returns to satisfy Rules of Hooks.
  const INITIAL_VISIBLE = 15;
  const LOAD_MORE_COUNT = 10;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const prevCatLenRef = useRef(0);

  // Pre-compute category count from raw data (before early returns) for hooks below
  const categoryCount = useMemo(() => {
    if (!data || !("rawItems" in data) || !data.rawItems) return 0;
    const items = data.rawItems as RawItem[];
    const seen = new Set<string>();
    for (const item of items) seen.add(item.category);
    return seen.size;
  }, [data]);

  // Reset visible count when categories change significantly (e.g. profile switch)
  useEffect(() => {
    if (categoryCount !== prevCatLenRef.current) {
      prevCatLenRef.current = categoryCount;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external data to local state
      setVisibleCount(INITIAL_VISIBLE);
    }
  }, [categoryCount]);

  // IntersectionObserver to load more categories as user scrolls
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(prev + LOAD_MORE_COUNT, categoryCount),
          );
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [categoryCount, visibleCount]);

  // Warn before navigating away with unsaved draft edits
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    if (editDrafts.size > 0) {
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [editDrafts.size]);

  const setDraft = useCallback(
    (id: number, colIndex: number, amount: number) => {
      setEditDrafts((prev) => {
        const next = new Map(prev);
        next.set(`${id}:${colIndex}`, amount);
        return next;
      });
    },
    [],
  );

  const getDraft = useCallback(
    (id: number, colIndex: number, original: number): number => {
      return editDrafts.get(`${id}:${colIndex}`) ?? original;
    },
    [editDrafts],
  );

  const editDraftsRef = useRef(editDrafts);
  const updateBatchRef = useRef(updateBatch);
  useEffect(() => {
    editDraftsRef.current = editDrafts;
    updateBatchRef.current = updateBatch;
  }, [editDrafts, updateBatch]);

  const saveAllDrafts = async () => {
    const drafts = editDraftsRef.current;
    if (drafts.size === 0) {
      setEditMode(false);
      return;
    }
    const updates = Array.from(drafts.entries()).map(([key, amount]) => {
      const [idStr, colStr] = key.split(":");
      return {
        id: parseInt(idStr!, 10),
        colIndex: parseInt(colStr!, 10),
        amount,
      };
    });
    await updateBatchRef.current.mutateAsync({ updates });
    setEditDrafts(new Map());
    setEditMode(false);
  };

  const toggleEditMode = () => {
    if (editMode) {
      saveAllDrafts();
    } else {
      setEditDrafts(new Map());
      setEditMode(true);
    }
  };

  // --- Name column resize ---
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const effectiveNameColWidth = dragWidth ?? nameColWidth;
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = nameColWidth;
      resizeRef.current = { startX, startW };
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setDragWidth(Math.max(120, Math.min(400, startW + delta)));
      };
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const finalWidth = Math.max(
          120,
          Math.min(400, startW + (ev.clientX - startX)),
        );
        setDragWidth(null);
        setNameColWidth(finalWidth);
        resizeRef.current = null;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [nameColWidth, setNameColWidth],
  );

  // --- Per-column contribution profile resolution (must be before early returns) ---

  const profile = data?.profile ?? null;
  const activeProfile = allProfiles?.find((p) => p.isActive) ?? null;
  const isViewingNonActive =
    displayProfileId != null && displayProfileId !== activeProfileId;
  const cols = useMemo(
    () => (data?.columnLabels as string[] | undefined) ?? [],
    [data?.columnLabels],
  );
  const numCols = cols.length;

  const columnContribProfileIds = useMemo(() => {
    if (!profile || numCols === 0) return [activeContribProfileId];
    const stored =
      (profile.columnContributionProfileIds as (number | null)[] | null) ??
      null;
    if (stored && stored.length === numCols) {
      return stored.map((id) => id ?? activeContribProfileId);
    }
    return cols.map(() => activeContribProfileId);
  }, [profile, numCols, cols, activeContribProfileId]);

  const perColumnPaycheckData = usePerColumnPaycheck(
    columnContribProfileIds,
    salaryOverrides,
  );

  const payrollBreakdowns: (PayrollBreakdown | null)[] = useMemo(
    () =>
      perColumnPaycheckData.map((d) =>
        buildPayrollBreakdown(d?.people ?? null),
      ),
    [perColumnPaycheckData],
  );

  const contribByCanonicalPerCol: Map<string, number>[] = useMemo(() => {
    return perColumnPaycheckData.map((pData) => {
      const map = new Map<string, number>();
      if (!pData) return map;

      const nonPayroll = buildNonPayrollContribs(pData.people);
      for (const [accountType, monthly] of Array.from(nonPayroll.entries())) {
        const key = normalizeContribKey(accountType);
        if (key) map.set(key, (map.get(key) ?? 0) + monthly);
      }

      if (pData.jointContribs) {
        for (const c of pData.jointContribs as Array<{
          accountType: string;
          contributionMethod: string;
          contributionValue: string | number;
        }>) {
          const val = Number(c.contributionValue) || 0;
          let monthly: number;
          if (c.contributionMethod === "fixed_monthly") {
            monthly = val;
          } else {
            monthly = val / 12;
          }
          const key = normalizeContribKey(c.accountType);
          if (key) map.set(key, (map.get(key) ?? 0) + monthly);
        }
      }

      return map;
    });
  }, [perColumnPaycheckData]);

  // --- Loading / error / empty states ---

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

  // --- Derived data ---

  const { allColumnResults, rawItems } = data;
  const columnMonths = (profile?.columnMonths as number[] | null) ?? null;
  const isWeighted = columnMonths !== null && columnMonths.length > 0;

  const categoryMap = new Map<string, RawItem[]>();
  for (const item of (rawItems ?? []) as RawItem[]) {
    const list = categoryMap.get(item.category) ?? [];
    list.push(item);
    categoryMap.set(item.category, list);
  }
  const categories = Array.from(categoryMap.entries());
  const categoryNames = categories.map(([name]) => name);

  const visibleCategories = categories.slice(0, visibleCount);
  const hasMoreCategories = visibleCount < categories.length;

  const getCatTotals = (items: RawItem[]) =>
    Array.from({ length: numCols }, (_, col) =>
      items.reduce(
        (s, it) =>
          s +
          (editMode
            ? getDraft(it.id, col, it.amounts[col] ?? 0)
            : it.contribAmount != null
              ? it.contribAmount
              : (it.amounts[col] ?? 0)),
        0,
      ),
    );

  // --- Sinking funds (savings goals with monthly contributions) ---

  const sinkingFunds: SinkingFundLine[] = (savingsGoals ?? [])
    .filter(
      (g: { isActive: boolean; monthlyContribution: string | number }) =>
        g.isActive && Number(g.monthlyContribution) > 0,
    )
    .map(
      (g: {
        id: number;
        name: string;
        monthlyContribution: string | number;
      }) => ({
        id: g.id,
        name: g.name,
        monthlyContribution: Number(g.monthlyContribution),
      }),
    );

  const matchContrib = (
    subcategory: string,
    colIdx?: number,
  ): number | null => {
    const map = contribByCanonicalPerCol[colIdx ?? 0];
    if (!map || map.size === 0) return null;
    const key = normalizeContribKey(subcategory);
    return key ? (map.get(key) ?? null) : null;
  };

  // --- API actuals ---
  const apiActualsMap = new Map<
    number,
    { activity: number; balance: number; budgeted: number }
  >();
  const showApiColumn = (apiActualsData?.actuals?.length ?? 0) > 0;
  const apiService = apiActualsData?.service ?? null;
  const apiLinkedProfileId = apiActualsData?.linkedProfileId ?? null;
  const apiLinkedColumnIndex = apiActualsData?.linkedColumnIndex ?? 0;
  if (apiActualsData?.actuals) {
    for (const a of apiActualsData.actuals) {
      apiActualsMap.set(a.budgetItemId, {
        activity: a.activity,
        balance: a.balance,
        budgeted: a.budgeted,
      });
    }
  }

  // --- Render ---

  return (
    <div>
      <PageHeader title="Budget" />

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("budget")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "budget"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-muted hover:text-secondary"
          }`}
        >
          Budget Profiles
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("contributions")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "contributions"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-muted hover:text-secondary"
          }`}
        >
          Contribution Profiles
        </button>
      </div>

      {activeTab === "budget" && (
        <CardBoundary title="Budget Profiles">
          {/* Active budget summary bar */}
          <BudgetSummaryBar
            profileName={profile?.name ?? null}
            activeProfileName={activeProfile?.name ?? null}
            isViewingNonActive={isViewingNonActive}
            profileId={profile?.id ?? null}
            apiService={apiService}
            apiLinkedProfileId={apiLinkedProfileId}
            apiLinkedColumnIndex={apiLinkedColumnIndex}
            showApiColumn={showApiColumn}
            cols={cols}
            activeColumn={activeColumn}
            isWeighted={isWeighted}
            columnMonths={columnMonths}
            allColumnResults={allColumnResults as ColumnResult[] | null}
            canEdit={canEdit}
            editMode={editMode}
            unsavedCount={editDrafts.size}
            saveError={updateBatch.error}
            pullError={syncFromApi.error}
            pushError={syncToApi.error}
            showModeManager={showModeManager}
            onToggleModeManager={() => setShowModeManager(!showModeManager)}
            isPulling={syncFromApi.isPending}
            isPushing={syncToApi.isPending}
            onPullFromApi={() =>
              syncFromApi.mutate({ selectedColumn: activeColumn })
            }
            onOpenPushPreview={() => {
              // Build diff preview from raw items + cached YNAB actuals
              const items: PushPreviewItem[] = [];
              for (const item of rawItems) {
                if (!item.apiCategoryId) continue;
                if (
                  item.apiSyncDirection !== "push" &&
                  item.apiSyncDirection !== "both"
                )
                  continue;
                const amounts = item.amounts as number[];
                const colIdx = Math.min(activeColumn, amounts.length - 1);
                const newValue = amounts[colIdx] ?? 0;
                const actual = apiActualsMap.get(item.id);
                items.push({
                  name: item.subcategory,
                  field: "Budgeted",
                  currentYnab: actual?.budgeted ?? 0,
                  newValue,
                });
              }
              setPushPreviewItems(items);
            }}
            isSavingBatch={updateBatch.isPending}
            onToggleEditMode={toggleEditMode}
          />

          {/* Master-detail layout */}
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
            {/* Left: profile list sidebar */}
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
                if (renameValue.trim() && renameValue.trim() !== currentName) {
                  renameProfile.mutate({ id, name: renameValue.trim() });
                }
                setRenamingProfileId(null);
              }}
              onCancelRename={() => setRenamingProfileId(null)}
              apiService={apiService}
              apiLinkedProfileId={apiLinkedProfileId}
              apiLinkedColumnIndex={apiLinkedColumnIndex}
              onSelectProfile={setViewingProfileId}
              onCreateProfile={(name) => createProfile.mutate({ name })}
              onSetActiveProfile={(id) => setActiveProfile.mutate({ id })}
              onDeleteProfile={(id) => deleteProfile.mutate({ id })}
            />

            {/* Right: budget detail panel */}
            <div className="border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-4">
              {canEdit && showModeManager && (
                <BudgetModeManager
                  cols={cols}
                  onRenameColumn={(idx, label) =>
                    renameColumn.mutate({ colIndex: idx, label })
                  }
                  onRemoveColumn={(idx) =>
                    removeColumn.mutate({ colIndex: idx })
                  }
                  onAddColumn={(label) => addColumn.mutate({ label })}
                  addColumnPending={addColumn.isPending}
                  contributionProfiles={
                    (contribProfiles ?? []) as Array<{
                      id: number;
                      name: string;
                      isDefault: boolean;
                    }>
                  }
                  columnContributionProfileIds={
                    (profile?.columnContributionProfileIds as
                      | (number | null)[]
                      | null) ?? null
                  }
                  onUpdateContributionProfiles={(ids) =>
                    updateColumnContribProfiles.mutate({
                      columnContributionProfileIds: ids,
                    })
                  }
                />
              )}

              {allColumnResults && (
                <BudgetSummaryTable
                  cols={cols}
                  activeColumn={activeColumn}
                  onSetActiveColumn={setActiveColumn}
                  allColumnResults={allColumnResults as ColumnResult[]}
                  payrollBreakdowns={payrollBreakdowns}
                  columnMonths={columnMonths}
                  onUpdateColumnMonths={(months) =>
                    updateColumnMonths.mutate({ columnMonths: months })
                  }
                  apiLinkedColumnIndex={
                    apiLinkedProfileId === profile?.id
                      ? apiLinkedColumnIndex
                      : null
                  }
                  apiService={apiService}
                  sinkingFunds={sinkingFunds}
                  nameColWidth={effectiveNameColWidth}
                />
              )}

              {cols.length > 1 && !isWeighted && (
                <p className="text-[10px] text-faint mb-2">
                  Click a column header to set the active budget mode used
                  across all pages
                </p>
              )}

              {/* Full budget table */}
              <BudgetTable
                visibleCategories={visibleCategories}
                hasMoreCategories={hasMoreCategories}
                numCols={numCols}
                cols={cols}
                categoryNames={categoryNames}
                getCatTotals={getCatTotals}
                effectiveNameColWidth={effectiveNameColWidth}
                onResizeStart={onResizeStart}
                sentinelRef={sentinelRef}
                apiService={apiService}
                apiLinkedProfileId={apiLinkedProfileId}
                profileId={profile?.id ?? null}
                apiLinkedColumnIndex={apiLinkedColumnIndex}
                showApiColumn={showApiColumn}
                apiActualsService={apiActualsData?.service ?? null}
                apiActualsMap={apiActualsMap}
                canEdit={canEdit}
                editMode={editMode}
                addingItemToCategory={addingItemToCategory}
                onSetAddingItemToCategory={setAddingItemToCategory}
                rowHandlers={{
                  getDraft,
                  setDraft,
                  onUpdateCell: (id, col, amt) =>
                    updateCell.mutate({ id, colIndex: col, amount: amt }),
                  onToggleItemEssential: (id, isEssential) =>
                    updateItemEssential.mutate({ id, isEssential }),
                  onToggleCategoryEssential: (category, isEssential) =>
                    updateCategoryEssential.mutate({ category, isEssential }),
                  onMoveItem: (id, newCategory) =>
                    moveItem.mutate({ id, newCategory }),
                  onDeleteItem: (id) => deleteItem.mutate({ id }),
                  onConvertToGoal: (id, name) =>
                    convertToGoal.mutate({
                      budgetItemId: id,
                      goalName: name,
                      targetMode: "ongoing",
                    }),
                  onAddItem: (category, subcategory, isEssential) =>
                    createItem.mutate({
                      category,
                      subcategory,
                      isEssential,
                    }),
                  addItemPending: createItem.isPending,
                  addItemError: createItem.error,
                  matchContrib: (sub) => matchContrib(sub),
                }}
              />

              {/* Standalone add-item form for new categories */}
              {canEdit &&
                addingItemToCategory &&
                !categoryMap.has(addingItemToCategory) && (
                  <AddItemForm
                    category={addingItemToCategory}
                    onAdd={(category, subcategory, isEssential) =>
                      void createItem
                        .mutateAsync({ category, subcategory, isEssential })
                        .then(() => setAddingItemToCategory(null))
                    }
                    onCancel={() => setAddingItemToCategory(null)}
                    isPending={createItem.isPending}
                    error={createItem.error}
                    standalone
                  />
                )}

              {canEdit && (
                <AddCategoryForm
                  onCreateCategory={(name) => setAddingItemToCategory(name)}
                />
              )}
            </div>
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

      {/* Push to YNAB preview modal */}
      {pushPreviewItems && (
        <BudgetPushYnabModal
          items={pushPreviewItems}
          activeColumnLabel={cols[activeColumn]}
          apiService={apiService}
          isPending={syncToApi.isPending}
          onConfirm={() => {
            syncToApi.mutate(
              { selectedColumn: activeColumn },
              { onSettled: () => setPushPreviewItems(null) },
            );
          }}
          onCancel={() => setPushPreviewItems(null)}
        />
      )}
    </div>
  );
}
