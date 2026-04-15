"use client";

/**
 * useBudgetDerivedData — extracted from budget-content.tsx (F4, v0.5.3).
 *
 * Owns: per-column contribution resolution, payroll breakdowns,
 * category/item derivation, sinking-fund list, API-actuals map,
 * matchContrib, and getCatTotals.
 *
 * All hooks run unconditionally (before early returns in the parent).
 * When `data` is null/undefined, outputs default to safe empty values.
 */

import { useMemo, useCallback } from "react";
import { usePerColumnPaycheck } from "@/lib/hooks/use-per-column-paycheck";
import {
  buildPayrollBreakdown,
  buildNonPayrollContribs,
} from "@/components/budget/helpers";
import { normalizeContribKey } from "@/lib/config/account-types";
import type {
  RawItem,
  PayrollBreakdown,
  ColumnResult,
  SinkingFundLine,
} from "@/components/budget";
import type { PushPreviewItem } from "@/components/ui/push-preview-modal";

type SalaryOverride = { personId: number; salary: number };

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
      }> | null;
    }
  | null
  | undefined;

export type SavingsGoalEntry = {
  id: number;
  name: string;
  isActive: boolean;
  monthlyContribution: string | number;
};

type DataShape =
  | {
      profile?: {
        id?: number;
        name?: string;
        columnContributionProfileIds?: (number | null)[] | null;
        columnMonths?: number[] | null;
      } | null;
      columnLabels?: unknown;
      allColumnResults?: unknown;
      rawItems?: unknown;
    }
  | null
  | undefined;

export function useBudgetDerivedData({
  data,
  savingsGoals,
  apiActualsData,
  salaryOverrides,
  activeContribProfileId,
  editMode,
  getDraft,
  visibleCount,
}: {
  data: DataShape;
  savingsGoals: SavingsGoalEntry[] | undefined;
  apiActualsData: ApiActualsData;
  salaryOverrides: SalaryOverride[];
  activeContribProfileId: number | null;
  editMode: boolean;
  getDraft: (id: number, colIndex: number, original: number) => number;
  visibleCount: number;
}) {
  // ---- Profile / column metadata ----

  const profile = data?.profile ?? null;

  const cols = useMemo(
    () => (data?.columnLabels as string[] | undefined) ?? [],
    [data?.columnLabels],
  );
  const numCols = cols.length;
  const columnMonths = (profile?.columnMonths as number[] | null) ?? null;
  const isWeighted = columnMonths !== null && columnMonths.length > 0;

  // ---- Per-column contribution profile resolution ----

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
          const monthly =
            c.contributionMethod === "fixed_monthly" ? val : val / 12;
          const key = normalizeContribKey(c.accountType);
          if (key) map.set(key, (map.get(key) ?? 0) + monthly);
        }
      }

      return map;
    });
  }, [perColumnPaycheckData]);

  const matchContrib = (
    subcategory: string,
    colIdx?: number,
  ): number | null => {
    const map = contribByCanonicalPerCol[colIdx ?? 0];
    if (!map || map.size === 0) return null;
    const key = normalizeContribKey(subcategory);
    return key ? (map.get(key) ?? null) : null;
  };

  // ---- Raw items + category derivation ----

  const allColumnResults =
    (data?.allColumnResults as ColumnResult[] | null | undefined) ?? null;

  const rawItems = useMemo(
    () => (data?.rawItems as RawItem[] | undefined) ?? [],
    [data?.rawItems],
  );

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
          let val: number;
          if (editMode) {
            val = getDraft(it.id, col, it.amounts[col] ?? 0);
          } else if (it.contribAmount != null) {
            val = it.contribAmount;
          } else {
            // Look up the per-column contribution profile before falling back
            // to the raw amounts array, so each column reflects its own
            // contribution profile rather than a single shared scalar.
            const map = contribByCanonicalPerCol[col];
            const key =
              map && map.size > 0 ? normalizeContribKey(it.subcategory) : null;
            const fromContrib = key != null ? (map!.get(key) ?? null) : null;
            val = fromContrib ?? it.amounts[col] ?? 0;
          }
          return s + val;
        }, 0),
      ),
    [numCols, editMode, getDraft, contribByCanonicalPerCol],
  );

  // ---- Sinking funds (savings goals with monthly contributions) ----

  const sinkingFunds: SinkingFundLine[] = useMemo(
    () =>
      (savingsGoals ?? [])
        .filter((g) => g.isActive && Number(g.monthlyContribution) > 0)
        .map((g) => ({
          id: g.id,
          name: g.name,
          monthlyContribution: Number(g.monthlyContribution),
        })),
    [savingsGoals],
  );

  // ---- API actuals map ----

  const apiActualsMap = useMemo(() => {
    const map = new Map<
      number,
      { activity: number; balance: number; budgeted: number }
    >();
    if (apiActualsData?.actuals) {
      for (const a of apiActualsData.actuals) {
        map.set(a.budgetItemId, {
          activity: a.activity,
          balance: a.balance,
          budgeted: a.budgeted,
        });
      }
    }
    return map;
  }, [apiActualsData]);

  // ---- Push-preview builder ----
  // Returns the diff items needed to render the "push to API" confirmation modal.
  const buildPushPreviewItems = (activeColumn: number): PushPreviewItem[] => {
    const items: PushPreviewItem[] = [];
    for (const item of rawItems) {
      if (!item.apiCategoryId) continue;
      if (item.apiSyncDirection !== "push" && item.apiSyncDirection !== "both")
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
    return items;
  };

  return {
    profile,
    cols,
    numCols,
    columnMonths,
    isWeighted,
    columnContribProfileIds,
    perColumnPaycheckData,
    payrollBreakdowns,
    matchContrib,
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
  };
}
