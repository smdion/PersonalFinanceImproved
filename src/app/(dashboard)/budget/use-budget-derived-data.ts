"use client";

/**
 * useBudgetDerivedData — extracted from budget-content.tsx.
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
  resolveContributionProfileIdsForAllColumns,
  resolveSalaryProfileIdsForAllColumns,
} from "@/lib/calculators/contribution-profile-resolution";
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

type SalaryActiveField = { personId: number; salary: number };

/** Non-column tiers of docs/RULES.md's profile precedence, supplied by the
 *  page (Plan pin → [column pin] → local selection → globally-active). */
export type ProfileResolutionTiers = {
  planPinId: number | null;
  localSelectionId: number | null;
  globalDefaultId: number | null;
};

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
        columnContributionProfileIds?: (number | null)[] | null;
        columnSalaryProfileIds?: (number | null)[] | null;
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
  salaryActiveFields,
  contributionProfileTiers,
  salaryProfileTiers,
  editMode,
  getDraft,
  visibleCount,
}: {
  data: DataShape;
  savingsGoals: SavingsGoalEntry[] | undefined;
  apiActualsData: ApiActualsData;
  salaryActiveFields: SalaryActiveField[];
  /** The non-column tiers of the profile precedence — must be the SAME
   *  values sent to budget.computeActiveSummary, or server totals and this
   *  page's payroll breakdown resolve different profiles. */
  contributionProfileTiers: ProfileResolutionTiers;
  salaryProfileTiers: ProfileResolutionTiers;
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
    if (numCols === 0) return [];
    const stored =
      (profile?.columnContributionProfileIds as (number | null)[] | null) ??
      null;
    return resolveContributionProfileIdsForAllColumns({
      ...contributionProfileTiers,
      columnPinIds: stored,
      numColumns: numCols,
    });
  }, [profile, numCols, contributionProfileTiers]);

  // ---- Per-column salary profile resolution ----
  // MUST match routers/budget.ts's computeActiveSummary resolution exactly
  // (it calls the same resolver with the same tiers), or budget item $
  // amounts and the payroll breakdown on this page silently disagree about
  // which salary reality is in effect.
  const columnSalaryProfileIds = useMemo(() => {
    if (numCols === 0) return [];
    const stored =
      (profile?.columnSalaryProfileIds as (number | null)[] | null) ?? null;
    return resolveSalaryProfileIdsForAllColumns({
      ...salaryProfileTiers,
      columnPinIds: stored,
      numColumns: numCols,
    });
  }, [profile, numCols, salaryProfileTiers]);

  const perColumnPaycheckData = usePerColumnPaycheck(
    columnContribProfileIds,
    salaryActiveFields,
    columnSalaryProfileIds,
  );

  const payrollBreakdowns: (PayrollBreakdown | null)[] = useMemo(
    () =>
      perColumnPaycheckData.map((d) =>
        buildPayrollBreakdown(d?.people ?? null),
      ),
    [perColumnPaycheckData],
  );

  // ---- Raw items ----
  // Declared before contribByCanonicalPerCol so the fuzzy-match pool below
  // can exclude accounts already linked to a budget item.

  const allColumnResults =
    (data?.allColumnResults as ColumnResult[] | null | undefined) ?? null;

  const rawItems = useMemo(
    () => (data?.rawItems as RawItem[] | undefined) ?? [],
    [data?.rawItems],
  );

  // A contribution account already linked to a budget item (via
  // contributionAccountId) has its real dollars resolved through that link
  // (contribAmounts/contribAmount) — it must not ALSO be eligible for
  // name-based matching against some OTHER unlinked item, or that other
  // item's badge/total silently borrows the linked account's balance
  // (e.g. two brokerage accounts sharing the keyword "brokerage", one
  // linked and one not).
  const linkedContributionAccountIds = useMemo(
    () =>
      new Set(
        rawItems
          .filter((it) => it.contributionAccountId != null)
          .map((it) => it.contributionAccountId!),
      ),
    [rawItems],
  );

  const contribByCanonicalPerCol: Map<string, number>[] = useMemo(() => {
    return perColumnPaycheckData.map((pData) => {
      const map = new Map<string, number>();
      if (!pData) return map;

      const nonPayroll = buildNonPayrollContribs(
        pData.people,
        linkedContributionAccountIds,
      );
      for (const [accountType, monthly] of Array.from(nonPayroll.entries())) {
        const key = normalizeContribKey(accountType);
        if (key) map.set(key, (map.get(key) ?? 0) + monthly);
      }

      if (pData.jointContribs) {
        for (const c of pData.jointContribs as Array<{
          id: number;
          accountType: string;
          contributionMethod: string;
          contributionValue: string | number;
        }>) {
          if (linkedContributionAccountIds.has(c.id)) continue;
          const val = Number(c.contributionValue) || 0;
          const monthly =
            c.contributionMethod === "fixed_monthly" ? val : val / 12;
          const key = normalizeContribKey(c.accountType);
          if (key) map.set(key, (map.get(key) ?? 0) + monthly);
        }
      }

      return map;
    });
  }, [perColumnPaycheckData, linkedContributionAccountIds]);

  // matchContrib is a display-only estimate for UNLINKED items (the "PC"
  // badge/tooltip) — it must never feed getCatTotals's total below, or the
  // page's own category subtotal disagrees with the server-computed
  // calculateBudget total (RULES.md Single Computation Path).
  const matchContrib = (
    subcategory: string,
    colIdx?: number,
  ): number | null => {
    const map = contribByCanonicalPerCol[colIdx ?? 0];
    if (!map || map.size === 0) return null;
    const key = normalizeContribKey(subcategory);
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
          // contribAmounts is the server's own per-column figure (column i
          // resolved with column i's profiles); contribAmount is only the
          // selected column's value and is the last resort before raw
          // amounts. Fuzzy name-matching (matchContrib) never contributes
          // here — it's a badge/tooltip-only estimate for UNLINKED items,
          // and folding it into the total would make this page's own
          // subtotal disagree with the server-computed calculateBudget
          // total (RULES.md Single Computation Path). This is the SAME
          // resolved value regardless of edit mode — editMode only adds a
          // draft on TOP of it (via getDraft's `original` argument), it
          // never bypasses this resolution chain. (Bypassing it here used
          // to make a contribution-linked item's total silently change the
          // instant edit mode turned on, before the user touched anything.)
          const resolved =
            it.contribAmounts?.[col] ??
            (it.contribAmount != null
              ? it.contribAmount
              : (it.amounts[col] ?? 0));
          const val = editMode ? getDraft(it.id, col, resolved) : resolved;
          return s + val;
        }, 0),
      ),
    [numCols, editMode, getDraft],
  );

  // ---- Sinking funds (savings goals with monthly contributions) ----
  // Reads the stored monthlyContribution snapshot directly, even for
  // percentage-based goals — it should only change when the user
  // explicitly hits "Recalculate" on the savings page (recalculateAllocation),
  // not whenever paycheck/budget data shifts underneath it.
  // `savingsGoals` here is already resolved server-side for the profile
  // being viewed (goals with no override fall back to the global default,
  // per getResolvedGoalAllocations) — this must not read a raw,
  // unresolved savings_goals row, or this total can silently disagree
  // with what the Savings page shows for the same profile.

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
  // Returns the diff items needed to render the "push to API" confirmation
  // modal. Ledgr's budget amount maps to YNAB's goal target (not the
  // month-specific "budgeted" field), matching what syncBudgetToApi writes.
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
        field: "Goal Target",
        currentYnab: actual?.goalTarget ?? 0,
        newValue,
      });
    }
    return items;
  };

  // ---- Pull-preview builder ----
  // Returns the diff items needed to render the "pull from API" confirmation
  // modal: current Ledgr amount vs. what it will become after pulling YNAB's
  // goal target, matching what syncBudgetFromApi reads.
  const buildPullPreviewItems = (activeColumn: number): PushPreviewItem[] => {
    const items: PushPreviewItem[] = [];
    for (const item of rawItems) {
      if (!item.apiCategoryId) continue;
      if (item.apiSyncDirection !== "pull" && item.apiSyncDirection !== "both")
        continue;
      const amounts = item.amounts as number[];
      const colIdx = Math.min(activeColumn, amounts.length - 1);
      const currentValue = amounts[colIdx] ?? 0;
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
    columnContribProfileIds,
    columnSalaryProfileIds,
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
    buildPullPreviewItems,
  };
}
