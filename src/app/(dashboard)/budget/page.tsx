"use client";

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
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
  BudgetCategoryRow,
  AddItemForm,
  AddCategoryForm,
  ContributionProfileManager,
} from "@/components/budget";
import type {
  RawItem,
  PayrollBreakdown,
  ColumnResult,
  SinkingFundLine,
} from "@/components/budget";
import { normalizeContribKey } from "@/lib/config/account-types";
import { formatCurrency } from "@/lib/utils/format";
import { confirm, promptText } from "@/components/ui/confirm-dialog";
import {
  PushPreviewModal,
  type PushPreviewItem,
} from "@/components/ui/push-preview-modal";
import { FormError } from "@/components/ui/form-error";

export default function BudgetPage() {
  const user = useUser();
  const canEdit = hasPermission(user, "budget");
  const utils = trpc.useUtils();
  const [activeColumn, setActiveColumn] = usePersistedSetting<number>(
    "budget_active_column",
    0,
  );
  const [nameColWidth, setNameColWidth] = usePersistedSetting<number>(
    "budget_name_col_width",
    192,
  );
  const { data, isLoading, error } = trpc.budget.getActiveSummary.useQuery({
    selectedColumn: activeColumn,
  });
  const { data: apiActualsData } = trpc.budget.listApiActuals.useQuery();
  const salaryOverrides = useSalaryOverrides();
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: allProfiles } = trpc.budget.listProfiles.useQuery();
  const { data: savingsGoals } = trpc.settings.savingsGoals.list.useQuery();
  const setActiveProfile = trpc.budget.setActiveProfile.useMutation({
    onSuccess: () => {
      utils.budget.listProfiles.invalidate();
      utils.budget.getActiveSummary.invalidate();
    },
  });
  const updateCell = trpc.budget.updateItemAmount.useMutation({
    onMutate: async (variables) => {
      await utils.budget.getActiveSummary.cancel();
      const queryInput = { selectedColumn: activeColumn };
      const previous = utils.budget.getActiveSummary.getData(queryInput);
      if (previous && "rawItems" in previous) {
        utils.budget.getActiveSummary.setData(queryInput, {
          ...previous,
          rawItems: previous.rawItems.map((item: typeof previous.rawItems[number]) => {
            if (item.id !== variables.id) return item;
            const newAmounts = [...item.amounts];
            newAmounts[variables.colIndex] = variables.amount;
            return { ...item, amounts: newAmounts };
          }),
        });
      }
      return { previous, queryInput };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.getActiveSummary.setData(context.queryInput, context.previous);
      }
    },
    onSettled: () => utils.budget.getActiveSummary.invalidate(),
  });
  const updateBatch = trpc.budget.updateItemAmounts.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const addColumn = trpc.budget.addColumn.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const removeColumn = trpc.budget.removeColumn.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const renameColumn = trpc.budget.renameColumn.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const createItem = trpc.budget.createItem.useMutation({
    onSuccess: () => {
      utils.budget.getActiveSummary.invalidate();
      setAddingItemToCategory(null);
    },
  });
  const deleteItem = trpc.budget.deleteItem.useMutation({
    onMutate: async (variables) => {
      await utils.budget.getActiveSummary.cancel();
      const queryInput = { selectedColumn: activeColumn };
      const previous = utils.budget.getActiveSummary.getData(queryInput);
      if (previous && "rawItems" in previous) {
        utils.budget.getActiveSummary.setData(queryInput, {
          ...previous,
          rawItems: previous.rawItems.filter((item: typeof previous.rawItems[number]) => item.id !== variables.id),
        });
      }
      return { previous, queryInput };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.getActiveSummary.setData(context.queryInput, context.previous);
      }
    },
    onSettled: () => utils.budget.getActiveSummary.invalidate(),
  });
  const moveItem = trpc.budget.moveItem.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const updateItemEssential = trpc.budget.updateItemEssential.useMutation({
    onMutate: async (variables) => {
      await utils.budget.getActiveSummary.cancel();
      const queryInput = { selectedColumn: activeColumn };
      const previous = utils.budget.getActiveSummary.getData(queryInput);
      if (previous && "rawItems" in previous) {
        utils.budget.getActiveSummary.setData(queryInput, {
          ...previous,
          rawItems: previous.rawItems.map((item: typeof previous.rawItems[number]) =>
            item.id === variables.id
              ? { ...item, isEssential: variables.isEssential }
              : item,
          ),
        });
      }
      return { previous, queryInput };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        utils.budget.getActiveSummary.setData(context.queryInput, context.previous);
      }
    },
    onSettled: () => utils.budget.getActiveSummary.invalidate(),
  });
  const updateCategoryEssential =
    trpc.budget.updateCategoryEssential.useMutation({
      onMutate: async (variables) => {
        await utils.budget.getActiveSummary.cancel();
        const queryInput = { selectedColumn: activeColumn };
        const previous = utils.budget.getActiveSummary.getData(queryInput);
        if (previous && "rawItems" in previous) {
          utils.budget.getActiveSummary.setData(queryInput, {
            ...previous,
            rawItems: previous.rawItems.map((item: typeof previous.rawItems[number]) =>
              item.category === variables.category
                ? { ...item, isEssential: variables.isEssential }
                : item,
            ),
          });
        }
        return { previous, queryInput };
      },
      onError: (_err, _variables, context) => {
        if (context?.previous) {
          utils.budget.getActiveSummary.setData(context.queryInput, context.previous);
        }
      },
      onSettled: () => utils.budget.getActiveSummary.invalidate(),
    });
  const updateColumnMonths = trpc.budget.updateColumnMonths.useMutation({
    onSuccess: () => {
      utils.budget.getActiveSummary.invalidate();
      utils.budget.listProfiles.invalidate();
    },
  });
  const updateColumnContribProfiles =
    trpc.budget.updateColumnContributionProfileIds.useMutation({
      onSuccess: () => {
        utils.budget.getActiveSummary.invalidate();
        utils.budget.listProfiles.invalidate();
      },
    });
  const syncFromApi = trpc.budget.syncBudgetFromApi.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const syncToApi = trpc.budget.syncBudgetToApi.useMutation({
    onSuccess: () => utils.budget.getActiveSummary.invalidate(),
  });
  const createProfile = trpc.budget.createProfile.useMutation({
    onSuccess: () => utils.budget.listProfiles.invalidate(),
  });
  const deleteProfile = trpc.budget.deleteProfile.useMutation({
    onSuccess: () => utils.budget.listProfiles.invalidate(),
  });
  const renameProfile = trpc.budget.renameProfile.useMutation({
    onSuccess: () => utils.budget.listProfiles.invalidate(),
  });
  const convertToGoal = trpc.savings.convertBudgetItemToGoal.useMutation({
    onSuccess: () => {
      utils.budget.getActiveSummary.invalidate();
      utils.savings.invalidate();
    },
  });

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
          setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, categoryCount));
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

  const saveAllDrafts = useCallback(async () => {
    if (editDrafts.size === 0) {
      setEditMode(false);
      return;
    }
    const updates = Array.from(editDrafts.entries()).map(([key, amount]) => {
      const [idStr, colStr] = key.split(":");
      return {
        id: parseInt(idStr!, 10),
        colIndex: parseInt(colStr!, 10),
        amount,
      };
    });
    await updateBatch.mutateAsync({ updates });
    setEditDrafts(new Map());
    setEditMode(false);
  }, [editDrafts, updateBatch]);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
      saveAllDrafts();
    } else {
      setEditDrafts(new Map());
      setEditMode(true);
    }
  }, [editMode, saveAllDrafts]);

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
  const cols = (data?.columnLabels as string[] | undefined) ?? [];
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
      <p className="text-red-600 text-sm">Failed to load budget: {error.message}</p>
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
        <>
          {/* Active budget summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-sunken rounded-lg px-4 py-3 mb-4">
            <div className="flex flex-wrap items-center gap-3 sm:gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold uppercase">
                  Active
                </span>
                <span className="text-xs text-muted">{profile?.name}</span>
                {apiService && apiLinkedProfileId === profile?.id && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">
                    ⇄ {apiService.toUpperCase()} →{""}
                    {cols[apiLinkedColumnIndex] ?? "Unknown"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs">
                {cols.length > 0 && !isWeighted && (
                  <span className="text-faint">
                    Mode:{""}
                    <span className="font-medium text-secondary">
                      {cols[activeColumn] ?? cols[0]}
                    </span>
                  </span>
                )}
                {isWeighted && (
                  <span className="text-faint">
                    Weighted{""}
                    <span className="text-[10px]">
                      (
                      {columnMonths
                        .map((m, i) => `${m}mo ${cols[i]}`)
                        .join(" +")}
                      )
                    </span>
                  </span>
                )}
                {allColumnResults && (
                  <span className="font-semibold text-secondary">
                    {formatCurrency(
                      isWeighted && columnMonths
                        ? (allColumnResults as ColumnResult[]).reduce(
                            (sum, r, i) =>
                              sum + r.totalMonthly * (columnMonths[i] ?? 0),
                            0,
                          )
                        : ((allColumnResults as ColumnResult[])[activeColumn]
                            ?.totalMonthly ?? 0) * 12,
                    )}
                    <span className="text-[10px] text-faint font-normal">
                      /yr
                    </span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && editMode && editDrafts.size > 0 && (
                <span className="text-xs text-amber-600">
                  {editDrafts.size} unsaved change
                  {editDrafts.size !== 1 ? "s" : ""}
                </span>
              )}
              {updateBatch.error && (
                <FormError error={updateBatch.error} prefix="Save failed" />
              )}
              {syncFromApi.error && (
                <FormError error={syncFromApi.error} prefix="Pull failed" />
              )}
              {syncToApi.error && (
                <FormError error={syncToApi.error} prefix="Push failed" />
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowModeManager(!showModeManager)}
                  className="px-2 py-1 text-[10px] font-medium rounded bg-surface-strong text-muted hover:bg-surface-strong"
                >
                  Manage Modes
                </button>
              )}
              {canEdit &&
                showApiColumn &&
                apiLinkedProfileId === profile?.id && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        syncFromApi.mutate({ selectedColumn: activeColumn })
                      }
                      disabled={syncFromApi.isPending}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                      title={`Pull linked amounts from ${apiService?.toUpperCase()} into"${cols[activeColumn]}" mode`}
                    >
                      {syncFromApi.isPending
                        ? "Pulling…"
                        : `Pull from ${apiService?.toUpperCase()}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
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
                          const colIdx = Math.min(
                            activeColumn,
                            amounts.length - 1,
                          );
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
                      disabled={syncToApi.isPending}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                      title={`Push"${cols[activeColumn]}" mode amounts to ${apiService?.toUpperCase()}`}
                    >
                      {syncToApi.isPending
                        ? "Pushing…"
                        : `Push to ${apiService?.toUpperCase()}`}
                    </button>
                  </>
                )}
              {canEdit &&
                showApiColumn &&
                apiLinkedProfileId !== profile?.id &&
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
                  onClick={toggleEditMode}
                  disabled={updateBatch.isPending}
                  className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                    editMode
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-surface-strong text-muted hover:bg-surface-strong"
                  }`}
                >
                  {updateBatch.isPending
                    ? "Saving…"
                    : editMode
                      ? "Save All"
                      : "Edit Mode"}
                </button>
              )}
            </div>
          </div>

          {/* Master-detail layout */}
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
            {/* Left: profile list sidebar */}
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
                      if (name) createProfile.mutate({ name });
                    }}
                    className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
                  >
                    + New
                  </button>
                )}
              </div>
              {(allProfiles ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.id !== profile?.id)
                      setActiveProfile.mutate({ id: p.id });
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors group ${
                    p.isActive
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
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => {
                            if (
                              renameValue.trim() &&
                              renameValue.trim() !== p.name
                            ) {
                              renameProfile.mutate({
                                id: p.id,
                                name: renameValue.trim(),
                              });
                            }
                            setRenamingProfileId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenamingProfileId(null);
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
                          ⇄ {apiService.toUpperCase()} →{""}
                          {(p.columnLabels as string[])?.[
                            apiLinkedColumnIndex
                          ] ?? "Mode" + apiLinkedColumnIndex}
                        </span>
                      )}
                    </div>
                    {canEdit && renamingProfileId !== p.id && (
                      <div
                        className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingProfileId(p.id);
                            setRenameValue(p.name);
                          }}
                          className="text-[10px] text-faint hover:text-blue-600"
                        >
                          edit
                        </button>
                        {!p.isActive && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (await confirm(`Delete profile"${p.name}"?`)) {
                                deleteProfile.mutate({ id: p.id });
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
                </button>
              ))}
            </div>

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
              <div className="overflow-x-auto relative">
                <table
                  className="w-full text-xs border-collapse"
                  style={{ tableLayout: "fixed" }}
                >
                  <thead>
                    <tr className="border-b-2 border-strong">
                      <th
                        className="text-left py-2 pr-3 text-muted font-medium sticky left-0 bg-surface-sunken z-10 select-none"
                        style={{
                          width: effectiveNameColWidth,
                          minWidth: 120,
                          maxWidth: 400,
                        }}
                      >
                        <span className="flex items-center justify-between">
                          <span>Category / Item</span>
                          <span
                            onMouseDown={onResizeStart}
                            className="cursor-col-resize px-1 text-faint hover:text-secondary select-none"
                            title="Drag to resize"
                          >
                            ⋮
                          </span>
                        </span>
                      </th>
                      {cols.map((label, colIdx) => (
                        <th
                          key={label}
                          className="text-right py-2 px-3 text-muted font-medium min-w-[90px]"
                        >
                          {label}
                          {apiService &&
                            apiLinkedProfileId === profile?.id &&
                            apiLinkedColumnIndex === colIdx && (
                              <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold align-middle">
                                ⇄ {apiService.toUpperCase()}
                              </span>
                            )}
                        </th>
                      ))}
                      {showApiColumn && (
                        <th className="text-right py-2 px-2 text-muted font-medium min-w-[80px] text-xs">
                          {apiActualsData?.service?.toUpperCase()}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCategories.map(([catName, items]) => (
                      <BudgetCategoryRow
                        key={catName}
                        categoryName={catName}
                        items={items}
                        numCols={numCols}
                        catTotals={getCatTotals(items)}
                        editMode={editMode}
                        getDraft={getDraft}
                        onSetDraft={setDraft}
                        onUpdateCell={(id, col, amt) =>
                          updateCell.mutate({ id, colIndex: col, amount: amt })
                        }
                        onToggleItemEssential={(id, isEssential) =>
                          updateItemEssential.mutate({ id, isEssential })
                        }
                        onToggleCategoryEssential={(category, isEssential) =>
                          updateCategoryEssential.mutate({
                            category,
                            isEssential,
                          })
                        }
                        onMoveItem={(id, newCategory) =>
                          moveItem.mutate({ id, newCategory })
                        }
                        onDeleteItem={(id) => deleteItem.mutate({ id })}
                        onConvertToGoal={(id, name) =>
                          convertToGoal.mutate({
                            budgetItemId: id,
                            goalName: name,
                            targetMode: "ongoing",
                          })
                        }
                        onAddItem={(category, subcategory, isEssential) =>
                          createItem.mutate({
                            category,
                            subcategory,
                            isEssential,
                          })
                        }
                        addItemPending={createItem.isPending}
                        addItemError={createItem.error}
                        categoryNames={categoryNames}
                        addingItemToCategory={addingItemToCategory}
                        onSetAddingItemToCategory={setAddingItemToCategory}
                        matchContrib={(sub) => matchContrib(sub)}
                        canEdit={canEdit}
                        apiActualsMap={apiActualsMap}
                        showApiColumn={showApiColumn}
                        nameColWidth={effectiveNameColWidth}
                      />
                    ))}
                    {hasMoreCategories && (
                      <tr ref={sentinelRef} aria-hidden="true">
                        <td
                          colSpan={numCols + (showApiColumn ? 2 : 1)}
                          className="text-center py-3 text-xs text-muted"
                        >
                          Loading more categories...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Standalone add-item form for new categories */}
              {canEdit &&
                addingItemToCategory &&
                !categoryMap.has(addingItemToCategory) && (
                  <AddItemForm
                    category={addingItemToCategory}
                    onAdd={(category, subcategory, isEssential) =>
                      createItem.mutate({ category, subcategory, isEssential })
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
        </>
      )}

      {activeTab === "contributions" && (
        <ContributionProfileManager
          canEdit={hasPermission(user, "contributionProfile")}
        />
      )}

      {/* Push to YNAB preview modal */}
      {pushPreviewItems && (
        <PushPreviewModal
          title={`Push"${cols[activeColumn]}" budget amounts to ${apiService?.toUpperCase()}`}
          items={pushPreviewItems}
          onConfirm={() => {
            syncToApi.mutate(
              { selectedColumn: activeColumn },
              { onSettled: () => setPushPreviewItems(null) },
            );
          }}
          onCancel={() => setPushPreviewItems(null)}
          isPending={syncToApi.isPending}
        />
      )}
    </div>
  );
}

// --- Helper functions (extracted from inline IIFEs) ---

function buildPayrollBreakdown(paycheckData: unknown): PayrollBreakdown | null {
  if (!paycheckData) return null;
  const data = paycheckData as Array<{
    paycheck: {
      periodsPerYear: number;
      gross: number;
      federalWithholding: number;
      ficaSS: number;
      ficaMedicare: number;
      preTaxDeductions: { name: string; amount: number }[];
      postTaxDeductions: { name: string; amount: number }[];
    } | null;
    job: unknown;
    person: { name: string };
    budgetPerMonth?: number;
    budgetNote?: string;
  }>;
  const activePeople = data.filter((d) => d.paycheck && d.job);
  if (activePeople.length === 0) return null;

  let grossMonthly = 0;
  let federalWithholding = 0;
  let ficaSS = 0;
  let ficaMedicare = 0;
  const preTaxLines: { name: string; monthly: number }[] = [];
  const postTaxLines: { name: string; monthly: number }[] = [];
  const takeHomeLines: { name: string; monthly: number }[] = [];
  const grossLines: { name: string; monthly: number }[] = [];

  // Collect budget notes from all people for dynamic help text
  const budgetNotes: string[] = [];

  for (const d of activePeople) {
    const pc = d.paycheck!;
    // Use server-provided budget periods per month (respects per-job override)
    const perMonth = d.budgetPerMonth ?? pc.periodsPerYear / 12;
    const toMonthly = (perPeriod: number) => perPeriod * perMonth;
    if (d.budgetNote) budgetNotes.push(d.budgetNote);

    grossMonthly += toMonthly(pc.gross);
    if (activePeople.length > 1) {
      grossLines.push({ name: d.person.name, monthly: toMonthly(pc.gross) });
    }
    federalWithholding += toMonthly(pc.federalWithholding);
    ficaSS += toMonthly(pc.ficaSS);
    ficaMedicare += toMonthly(pc.ficaMedicare);

    for (const ded of pc.preTaxDeductions) {
      const label =
        activePeople.length > 1 ? `${ded.name} (${d.person.name})` : ded.name;
      preTaxLines.push({ name: label, monthly: toMonthly(ded.amount) });
    }
    for (const ded of pc.postTaxDeductions) {
      const label =
        activePeople.length > 1 ? `${ded.name} (${d.person.name})` : ded.name;
      postTaxLines.push({ name: label, monthly: toMonthly(ded.amount) });
    }

    if (activePeople.length > 1) {
      const personTaxes = toMonthly(
        pc.federalWithholding + pc.ficaSS + pc.ficaMedicare,
      );
      const personPreTax = pc.preTaxDeductions.reduce(
        (s, ded) => s + toMonthly(ded.amount),
        0,
      );
      const personPostTax = pc.postTaxDeductions.reduce(
        (s, ded) => s + toMonthly(ded.amount),
        0,
      );
      takeHomeLines.push({
        name: d.person.name,
        monthly:
          toMonthly(pc.gross) - personTaxes - personPreTax - personPostTax,
      });
    }
  }

  const totalPreTax = preTaxLines.reduce((s, d) => s + d.monthly, 0);
  const totalPostTax = postTaxLines.reduce((s, d) => s + d.monthly, 0);
  const totalTaxes = federalWithholding + ficaSS + ficaMedicare;
  const netMonthly = grossMonthly - totalTaxes - totalPreTax - totalPostTax;

  // Build dynamic budget note from all people's notes
  const budgetNote =
    budgetNotes.length > 0
      ? budgetNotes.join("; ")
      : "Regular monthly pay";

  return {
    grossMonthly,
    federalWithholding,
    ficaSS,
    ficaMedicare,
    totalTaxes,
    preTaxLines,
    totalPreTax,
    postTaxLines,
    totalPostTax,
    netMonthly,
    takeHomeLines,
    grossLines,
    budgetNote,
  };
}

function buildNonPayrollContribs(paycheckData: unknown): Map<string, number> {
  if (!paycheckData) return new Map();
  const data = paycheckData as Array<{
    paycheck: { periodsPerYear: number } | null;
    job: unknown;
    salary?: number;
    rawContribs?: Array<{
      jobId: number | null;
      contributionValue: string | number;
      contributionMethod: string;
      accountType: string;
    }>;
  }>;
  const map = new Map<string, number>();
  for (const d of data) {
    if (!d.paycheck || !d.job) continue;
    for (const c of d.rawContribs ?? []) {
      if (c.jobId !== null) continue;
      const val = Number(c.contributionValue) || 0;
      const periodsPerYear = d.paycheck.periodsPerYear;
      let monthly: number;
      if (c.contributionMethod === "percent_of_salary") {
        monthly = ((val / 100) * (d.salary ?? 0)) / 12;
      } else if (c.contributionMethod === "fixed_monthly") {
        monthly = val;
      } else {
        monthly = (val * periodsPerYear) / 12;
      }
      const existing = map.get(c.accountType) ?? 0;
      map.set(c.accountType, existing + monthly);
    }
  }
  return map;
}
