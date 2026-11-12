"use client";

/**
 * useBudgetDerivedData: payroll breakdown, category/item derivation, sinking
 * funds, API actuals, matchContribution and getCatTotals. Hooks always run;
 * null `data` yields safe empty outputs.
 */

import { budgetItemAmount } from "@/lib/pure/budget/item-amount";
import { trpc } from "@/lib/trpc";
import { useMemo, useCallback } from "react";
import {
  buildPayrollBreakdown,
  buildNonPayrollContributions,
} from "@/components/budget/helpers";
import { normalizeContributionKey } from "@/lib/config/account-types";
import type {
  RawItem,
  PayrollBreakdown,
  ColumnResult,
  SinkingFundLine,
} from "@/components/budget";
import type { PushPreviewItem } from "@/components/ui/push-preview-modal";

type ApiActualsData =
  | {
      service?: string | null;
      linkedProfileId?: number | null;
      linkedColumnIndex?: number | null;
      actuals?: Array<{
        budgetItemId: number;
        activity: number;
        balance: number;
        budgeted: number;
        goalTarget: number;
      }> | null;
    }
  | null
  | undefined;

export type SavingsGoalEntry = {
  id: number;
  name: string;
  isActive: boolean;
  monthlyContribution: string | number;
  allocationPercent?: string | number | null;
};

type DataShape =
  | {
      profile?: {
        id?: number;
        name?: string;
        columnMonths?: number[] | null;
      } | null;
      columnLabels?: string[];
      allColumnResults?: unknown;
      rawItems?: unknown;
    }
  | null
  | undefined;

export function useBudgetDerivedData({
  data,
  savingsGoals,
  apiActualsData,
  contributionProfileId,
  salaryProfileId,
  editMode,
  getDraft,
  visibleCount,
}: {
  data: DataShape;
  savingsGoals: SavingsGoalEntry[] | undefined;
  apiActualsData: ApiActualsData;
  /** The profiles budget.computeActiveSummary resolves for this page (its
   *  pick, else the active one), so the payroll breakdown matches it. */
  contributionProfileId: number | null;
  salaryProfileId: number | null;
  editMode: boolean;
  getDraft: (id: number, colIndex: number, original: number) => number;
  visibleCount: number;
}) {
  // ---- Profile / column metadata ----

  const profile = data?.profile ?? null;

  const cols = useMemo(() => data?.columnLabels ?? [], [data?.columnLabels]);
  const numCols = cols.length;
  const columnMonths = (profile?.columnMonths as number[] | null) ?? null;
  const isWeighted = columnMonths !== null && columnMonths.length > 0;

  // ---- Pay under the profiles this page shows ----
  // A column is a spending level, not a different pay world: one paycheck query
  // (local What-If selection, else the active profiles) serves every column.
  const { data: paycheckData } = trpc.paycheck.computeSummary.useQuery({
    ...(contributionProfileId != null
      ? { contributionProfileId: contributionProfileId }
      : {}),
    ...(salaryProfileId != null ? { salaryProfileId } : {}),
  });
  const perColumnPaycheckData = useMemo(
    () => Array.from({ length: numCols }, () => paycheckData ?? null),
    [numCols, paycheckData],
  );

  const payrollBreakdowns: (PayrollBreakdown | null)[] = useMemo(
    () =>
      perColumnPaycheckData.map((d) =>
        buildPayrollBreakdown(d?.people ?? null),
      ),
    [perColumnPaycheckData],
  );

  // ---- Raw items ----
  // Declared before contributionByCanonicalPerCol so the fuzzy-match pool below
  // can exclude accounts already linked to a budget item.

  const allColumnResults =
    (data?.allColumnResults as ColumnResult[] | null | undefined) ?? null;

  const rawItems = useMemo(
    () => (data?.rawItems as RawItem[] | undefined) ?? [],
    [data?.rawItems],
  );

  // Accounts already linked to a budget item resolve through that link, so
  // they're excluded from name matching; otherwise an unlinked item sharing a
  // keyword would borrow the linked account's dollars.
  const linkedContributionAccountIds = useMemo(
    () =>
      new Set(
        rawItems
          .filter((it) => it.contributionAccountId != null)
          .map((it) => it.contributionAccountId!),
      ),
    [rawItems],
  );

  const contributionByCanonicalPerCol: Map<string, number>[] = useMemo(() => {
    return perColumnPaycheckData.map((pData) => {
      const map = new Map<string, number>();
      if (!pData) return map;

      const nonPayroll = buildNonPayrollContributions(
        pData.people,
        linkedContributionAccountIds,
      );
      for (const [accountType, monthly] of Array.from(nonPayroll.entries())) {
        const key = normalizeContributionKey(accountType);
        if (key) map.set(key, (map.get(key) ?? 0) + monthly);
      }

      for (const c of pData.jointContribs) {
        if (linkedContributionAccountIds.has(c.id)) continue;
        const key = normalizeContributionKey(c.accountType);
        if (key) map.set(key, (map.get(key) ?? 0) + c.monthly);
      }

      return map;
    });
  }, [perColumnPaycheckData, linkedContributionAccountIds]);

  // Display-only estimate for UNLINKED items (the "PC" badge). Never feed it
  // into getCatTotals, or the subtotal disagrees with calculateBudget's total.
  const matchContribution = (
    subcategory: string,
    colIndex?: number,
  ): number | null => {
    const map = contributionByCanonicalPerCol[colIndex ?? 0];
    if (!map || map.size === 0) return null;
    const key = normalizeContributionKey(subcategory);
    return key ? (map.get(key) ?? null) : null;
  };

  // ---- Category derivation ----

  const categoryMap = useMemo(() => {
    const map = new Map<string, RawItem[]>();
    for (const item of rawItems) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [rawItems]);

  const categories = useMemo(
    () => Array.from(categoryMap.entries()),
    [categoryMap],
  );
  const categoryNames = useMemo(
    () => categories.map(([name]) => name),
    [categories],
  );
  const visibleCategories = useMemo(
    () => categories.slice(0, visibleCount),
    [categories, visibleCount],
  );
  const hasMoreCategories = visibleCount < categories.length;

  const getCatTotals = useCallback(
    (items: RawItem[]) =>
      Array.from({ length: numCols }, (_, col) =>
        items.reduce((s, it) => {
          // Server per-column figure, then the selected column's contribAmount,
          // then raw amounts. Never matchContribution (badge-only). Edit mode
          // only layers a draft on top via getDraft's `original`.
          const resolved =
            it.contribAmounts?.[col] ??
            (it.contribAmount != null
              ? it.contribAmount
              : budgetItemAmount(it.amounts, col, numCols));
          const val = editMode ? getDraft(it.id, col, resolved) : resolved;
          return s + val;
        }, 0),
      ),
    [numCols, editMode, getDraft],
  );

  // ---- Sinking funds (savings goals with monthly contributions) ----
  // Uses the stored monthlyContribution snapshot (changes only on "Recalculate"),
  // from goals already resolved server-side for the viewed profile.

  const sinkingFunds: SinkingFundLine[] = useMemo(
    () =>
      (savingsGoals ?? [])
        .filter((g) => g.isActive)
        .map((g) => ({
          id: g.id,
          name: g.name,
          monthlyContribution: Number(g.monthlyContribution),
        }))
        .filter((f) => f.monthlyContribution > 0),
    [savingsGoals],
  );

  // ---- API actuals map ----

  const apiActualsMap = useMemo(() => {
    const map = new Map<
      number,
      {
        activity: number;
        balance: number;
        budgeted: number;
        goalTarget: number;
      }
    >();
    if (apiActualsData?.actuals) {
      for (const a of apiActualsData.actuals) {
        map.set(a.budgetItemId, {
          activity: a.activity,
          balance: a.balance,
          budgeted: a.budgeted,
          goalTarget: a.goalTarget,
        });
      }
    }
    return map;
  }, [apiActualsData]);

  // ---- Push-preview builder ----
  // Diff items for the "push to API" modal. Ledgr's amount maps to YNAB's goal
  // target (not month "budgeted"), as syncBudgetToApi writes.
  const buildPushPreviewItems = (activeColumn: number): PushPreviewItem[] => {
    const items: PushPreviewItem[] = [];
    for (const item of rawItems) {
      if (!item.apiCategoryId) continue;
      if (item.apiSyncDirection !== "push" && item.apiSyncDirection !== "both")
        continue;
      // Contribution-linked items keep `amounts` stale (see
      // resolveLinkedBudgetItemAmounts); the pushed figure is `contribAmounts`.
      const amounts = item.contribAmounts ?? item.amounts;
      const colIndex = Math.min(activeColumn, numCols - 1);
      const newValue = budgetItemAmount(amounts, colIndex, numCols);
      const actual = apiActualsMap.get(item.id);
      items.push({
        name: item.subcategory,
        field: "Goal Target",
        currentYnab: actual?.goalTarget ?? 0,
        newValue,
      });
    }
    return items;
  };

  // ---- Pull-preview builder ----
  // Diff items for the "pull from API" modal: current amount vs. YNAB's goal
  // target, as syncBudgetFromApi reads.
  const buildPullPreviewItems = (activeColumn: number): PushPreviewItem[] => {
    const items: PushPreviewItem[] = [];
    for (const item of rawItems) {
      if (!item.apiCategoryId) continue;
      if (item.apiSyncDirection !== "pull" && item.apiSyncDirection !== "both")
        continue;
      const colIndex = Math.min(activeColumn, numCols - 1);
      const currentValue = budgetItemAmount(item.amounts, colIndex, numCols);
      const actual = apiActualsMap.get(item.id);
      items.push({
        name: item.subcategory,
        field: "Goal Target",
        currentYnab: currentValue,
        newValue: actual?.goalTarget ?? 0,
      });
    }
    return items;
  };

  return {
    profile,
    cols,
    numCols,
    columnMonths,
    isWeighted,
    perColumnPaycheckData,
    payrollBreakdowns,
    matchContribution,
    allColumnResults,
    rawItems,
    categoryMap,
    categories,
    categoryNames,
    visibleCategories,
    hasMoreCategories,
    getCatTotals,
    sinkingFunds,
    apiActualsMap,
    buildPushPreviewItems,
    buildPullPreviewItems,
  };
}
