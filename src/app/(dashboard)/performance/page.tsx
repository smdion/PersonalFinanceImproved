"use client";

/** Portfolio performance page tracking time-weighted returns across accounts and time periods. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { formatDate } from "@/lib/utils/format";
import {
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_BROKERAGE,
  FULLY_RETIREMENT_PERF_CATEGORIES,
  accountTypeToPerformanceCategory,
  type PerfCategory,
} from "@/lib/config/display-labels";
import { isRetirementParent } from "@/lib/config/account-types";
import { PageHeader } from "@/components/ui/page-header";
import { SlidePanel } from "@/components/ui/slide-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import {
  LifetimeSummaryCards,
  CategoryTabs,
  TabGroup,
  PerformanceTable,
  FinalizeYearModal,
  UpdatePerformanceForm,
  AccountPicker,
  YearRangePicker,
  FilteredSummary,
  FilteredAccountTable,
} from "@/components/performance";
import type { YearRange } from "@/components/performance";
import { PendingRollovers } from "@/components/performance/pending-rollovers";
import type {
  AnnualRow,
  AccountRow,
  MasterAccount,
} from "@/components/performance/types";
import type { EditingCell } from "@/components/performance";
import {
  aggregateAccountsByYear,
  chainReturns,
  type AccountRowLike,
} from "@/lib/pure/performance";

export default function PerformancePage() {
  const user = useUser();
  const canEdit = hasPermission(user, "performance");
  const { data, isLoading, error } = trpc.performance.computeSummary.useQuery();
  const utils = trpc.useUtils();
  const [activeCategory, setActiveCategory] = useState("Portfolio");
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [showUpdatePerformance, setShowUpdatePerformance] = useState(false);
  const [tableLocked, setTableLocked] = useState(true);

  // ── Custom account/year filtering (additive — CategoryTabs still work
  // standalone; this is a separate, opt-in view). Persisted as string-
  // encoded scalars since usePersistedSetting's generic is narrower than
  // Set<number>/{start,end} — see plan doc section 3.
  const [useCustomFilter, setUseCustomFilter] = usePersistedSetting<boolean>(
    "performance_use_custom_filter",
    false,
  );
  const [selectedAccountIdsStr, setSelectedAccountIdsStr] =
    usePersistedSetting<string>("performance_selected_account_ids", "");
  const [yearRangeStr, setYearRangeStr] = usePersistedSetting<string>(
    "performance_year_range",
    "",
  );

  const updateAnnual = trpc.performance.updateAnnual.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });
  const updateAccount = trpc.performance.updateAccount.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });
  const updateCostBasis = trpc.performance.updateCostBasis.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });
  const finalizeYear = trpc.performance.finalizeYear.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <SkeletonChart height={256} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load performance data: {error.message}
      </p>
    );
  }

  if (!data) {
    return (
      <EmptyState
        message="No performance data available."
        hint="Finalize a year in the Performance page after adding portfolio snapshots."
      />
    );
  }

  const {
    accountTypeCategories,
    parentCategories,
    currentYear,
    annualRows: annualRowsRaw,
    accountRows,
    masterAccounts,
    lifetimeTotals,
    lastSnapshotDate,
    performanceLastUpdated,
    pendingRollovers,
    balanceMismatch,
  } = data;
  // Router always produces valid PerfCategory values via getEffectiveCategory.
  const annualRows = annualRowsRaw as AnnualRow[];
  const filtered = annualRows.filter((r) => r.category === activeCategory);

  // ── Custom filter derived state ──
  const typedMasterAccounts = masterAccounts as MasterAccount[];
  // The default/"everything" set must include INACTIVE accounts too — a
  // closed/rolled-over account still had real balances in past years, and
  // the router's own Portfolio/Retirement rollups don't filter by current
  // isActive status when summing historical account_performance rows (see
  // isInRetirementRollup below). Restricting the default to active-only
  // would make historical years permanently fail to match a whole-category
  // selection, defeating the stored-data-preference logic. The account
  // picker's own "Show inactive" toggle is a separate display concern —
  // whether to show inactive accounts in the checkbox list — independent
  // of whether they're included in the default selection.
  const allAccountIds = new Set(typedMasterAccounts.map((m) => m.id));
  // "" = never chosen (default to all); "none" = explicitly empty selection.
  const selectedAccountIds =
    selectedAccountIdsStr === "none"
      ? new Set<number>()
      : typeof selectedAccountIdsStr === "string" && selectedAccountIdsStr
        ? new Set(
            selectedAccountIdsStr
              .split(",")
              .map(Number)
              .filter((n) => !Number.isNaN(n)),
          )
        : allAccountIds;
  const setSelectedAccountIds = (ids: Set<number>) => {
    const isDefault =
      ids.size === allAccountIds.size &&
      [...allAccountIds].every((id) => ids.has(id));
    setSelectedAccountIdsStr(
      isDefault
        ? ""
        : ids.size === 0
          ? "none"
          : [...ids].sort((a, b) => a - b).join(","),
    );
  };

  const nowYear = new Date().getFullYear();
  const accountYears = (accountRows as Array<{ year: number }>).map(
    (r) => r.year,
  );
  const minYear = accountYears.length
    ? Math.min(...accountYears)
    : (currentYear ?? nowYear);
  const maxYear = accountYears.length
    ? Math.max(...accountYears)
    : (currentYear ?? nowYear);

  const yearRange: YearRange | null =
    typeof yearRangeStr === "string" && yearRangeStr
      ? (() => {
          const [start, end] = yearRangeStr.split("-").map(Number);
          return { start: start ?? minYear, end: end ?? maxYear };
        })()
      : null;
  const setYearRange = (range: YearRange | null) =>
    setYearRangeStr(range ? `${range.start}-${range.end}` : "");
  const effectiveYearRange = yearRange ?? { start: minYear, end: maxYear };

  const accountRowLikes: AccountRowLike[] = (
    accountRows as Array<{
      performanceAccountId: number | null;
      year: number;
      beginningBalance: number;
      totalContributions: number;
      yearlyGainLoss: number;
      endingBalance: number;
      employerContributions: number;
      distributions: number;
      fees: number;
      rollovers: number;
    }>
  ).map((r) => ({
    performanceAccountId: r.performanceAccountId,
    year: r.year,
    beginningBalance: String(r.beginningBalance),
    totalContributions: String(r.totalContributions),
    yearlyGainLoss: String(r.yearlyGainLoss),
    endingBalance: String(r.endingBalance),
    employerContributions: String(r.employerContributions),
    distributions: String(r.distributions),
    fees: String(r.fees),
    rollovers: String(r.rollovers),
  }));

  // A finalized annual row's stored values can differ from a fresh sum of
  // account_performance rows (manual overrides at finalize time, historical
  // spreadsheet-seeded data) — see plan doc addendum. When the current
  // selection, restricted to accounts with data that year, exactly matches
  // an existing category's accounts for that year, prefer the finalized
  // annual row's stored values so this view agrees with the main table for
  // the common "just filter to a whole category" case. Falls back to a live
  // account-level sum for any selection that isn't a whole-category match
  // (which is the common case for genuinely ad hoc subsets, and always the
  // case for the current/non-finalized year, which the main table itself
  // computes live too).
  function setsEqual(a: Set<number>, b: Set<number>): boolean {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }
  // Mirrors the router's exact rollup definitions (performance.ts ~line
  // 530-620) — NOT a blanket parentCategory filter. Retirement = every
  // 401k/IRA + HSA account (regardless of parentCategory) plus only the
  // Brokerage-category accounts tagged parentCategory==="Retirement".
  // Portfolio = grand total of every account-type category, unconditionally.
  function isInRetirementRollup(
    accountType: string | null,
    parentCategory: string,
  ): boolean {
    const cat = accountTypeToPerformanceCategory(accountType);
    if ((FULLY_RETIREMENT_PERF_CATEGORIES as readonly string[]).includes(cat)) {
      return true;
    }
    return (
      cat === PERF_CATEGORY_BROKERAGE && isRetirementParent(parentCategory)
    );
  }
  function matchedCategoryForYear(year: number): string | null {
    const yearAccounts = (accountRows as AccountRow[]).filter(
      (r) => r.year === year,
    );
    const selectionThisYear = new Set(
      [...selectedAccountIds].filter((id) =>
        yearAccounts.some((r) => r.performanceAccountId === id),
      ),
    );
    if (selectionThisYear.size === 0) return null;

    for (const cat of accountTypeCategories ?? []) {
      const catIds = new Set(
        yearAccounts
          .filter(
            (r) => accountTypeToPerformanceCategory(r.accountType) === cat,
          )
          .map((r) => r.performanceAccountId)
          .filter((id): id is number => id != null),
      );
      if (catIds.size > 0 && setsEqual(catIds, selectionThisYear)) return cat;
    }
    if ((parentCategories ?? []).includes("Retirement")) {
      const retIds = new Set(
        yearAccounts
          .filter((r) => isInRetirementRollup(r.accountType, r.parentCategory))
          .map((r) => r.performanceAccountId)
          .filter((id): id is number => id != null),
      );
      if (retIds.size > 0 && setsEqual(retIds, selectionThisYear)) {
        return "Retirement";
      }
    }
    if ((parentCategories ?? []).includes("Portfolio")) {
      const allIds = new Set(
        yearAccounts
          .map((r) => r.performanceAccountId)
          .filter((id): id is number => id != null),
      );
      if (allIds.size > 0 && setsEqual(allIds, selectionThisYear)) {
        return "Portfolio";
      }
    }
    return null;
  }

  const filteredYearRows = useCustomFilter
    ? aggregateAccountsByYear(
        accountRowLikes,
        selectedAccountIds,
        effectiveYearRange,
      ).map((row) => {
        const matchedCategory = matchedCategoryForYear(row.year);
        if (!matchedCategory) return row;
        const stored = annualRows.find(
          (r) =>
            r.year === row.year &&
            r.category === matchedCategory &&
            r.isFinalized,
        );
        if (!stored) return row;
        return {
          year: row.year,
          beginBal: stored.beginningBalance,
          contribs: stored.totalContributions,
          gainLoss: stored.yearlyGainLoss,
          endBal: stored.endingBalance,
          employer: stored.employerContributions,
          distributions: stored.distributions,
          fees: stored.fees,
          rollovers: stored.rollovers,
          returnPct: stored.annualReturnPct,
        };
      })
    : [];
  const chained = chainReturns(filteredYearRows.map((r) => r.returnPct));
  const isMultiYearRange = effectiveYearRange.end > effectiveYearRange.start;
  const filteredTotalGainLoss = filteredYearRows.reduce(
    (s, r) => s + r.gainLoss,
    0,
  );
  const filteredEndingBalance =
    filteredYearRows.length > 0
      ? filteredYearRows[filteredYearRows.length - 1]!.endBal
      : 0;

  // ── Quick-select toggle buttons — reuses CategoryTabs' own TabGroup
  // component so this looks and behaves exactly like the category page's
  // "By Account" / "Rollup" split, instead of plain unstateful links.
  const accountTypeQuickSelects: { label: string; ids: Set<number> }[] = (
    accountTypeCategories ?? []
  ).map((cat) => ({
    label: cat,
    ids: new Set(
      typedMasterAccounts
        .filter((m) => accountTypeToPerformanceCategory(m.accountType) === cat)
        .map((m) => m.id),
    ),
  }));
  const rollupQuickSelects: { label: string; ids: Set<number> }[] = [
    {
      label: "Retirement",
      ids: new Set(
        typedMasterAccounts
          .filter((m) => isInRetirementRollup(m.accountType, m.parentCategory))
          .map((m) => m.id),
      ),
    },
    { label: "Portfolio", ids: allAccountIds },
  ].filter((o) =>
    (parentCategories as readonly string[] | undefined)?.includes(o.label),
  );
  const allQuickSelects = [...accountTypeQuickSelects, ...rollupQuickSelects];
  const activeQuickSelect =
    allQuickSelects.find((o) => setsEqual(o.ids, selectedAccountIds))?.label ??
    "";
  const onQuickSelectChange = (label: string) => {
    const match = allQuickSelects.find((o) => o.label === label);
    if (match) setSelectedAccountIds(new Set(match.ids));
  };

  function startEdit(
    type: "annual" | "account" | "master",
    id: number,
    field: string,
    currentValue: number,
  ) {
    if (!canEdit) return;
    setEditingCell({ type, id, field });
    setEditValue(String(currentValue));
  }

  function saveEdit() {
    if (!editingCell) return;
    const { type, id, field } = editingCell;
    const value = editValue.trim();
    if (value === "") {
      setEditingCell(null);
      return;
    }
    if (type === "annual") {
      updateAnnual.mutate({ id, [field]: value });
    } else if (type === "master") {
      updateCostBasis.mutate({ performanceAccountId: id, costBasis: value });
    } else {
      updateAccount.mutate({ id, [field]: value });
    }
    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Annual Performance"
        subtitle={
          <div className="flex items-center gap-3">
            {performanceLastUpdated && (
              <span>
                Performance updated: {formatDate(performanceLastUpdated)}
              </span>
            )}
            {performanceLastUpdated && lastSnapshotDate && <span>·</span>}
            {lastSnapshotDate && (
              <span>Last snapshot: {formatDate(lastSnapshotDate)}</span>
            )}
          </div>
        }
      >
        {canEdit && currentYear && (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={() => setShowUpdatePerformance(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
            >
              Update Performance
            </button>
            <span className="inline-flex items-center gap-1">
              <button
                onClick={() => setShowFinalizeModal(true)}
                disabled={finalizeYear.isPending}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {finalizeYear.isPending
                  ? "Finalizing..."
                  : `Finalize ${currentYear}`}
              </button>
              <HelpTip text="Locks in this year's performance data as the source of truth, computes lifetime totals, and creates next year's rows for all active accounts with beginning balances carried forward. Finalized values can still be manually edited afterward." />
            </span>
          </span>
        )}
      </PageHeader>

      {lifetimeTotals && (
        <LifetimeSummaryCards
          totals={lifetimeTotals}
          snapshotDate={lastSnapshotDate}
        />
      )}

      {/* Ending balance consistency warning */}
      {balanceMismatch && (
        <div className="mb-3 rounded-md border border-orange-400/60 bg-orange-50/40 dark:bg-orange-950/20 px-3 py-2 text-xs text-orange-800 dark:text-orange-300 flex items-start gap-2">
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <span>
            <span className="font-semibold">Balance mismatch:</span> Performance
            account totals (
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(balanceMismatch.perfTotal)}
            ) differ from portfolio snapshot (
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(balanceMismatch.snapTotal)}
            ) by{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(Math.abs(balanceMismatch.delta))}
            {balanceMismatch.explainedByPending
              ? " — this matches your pending rollover(s)."
              : ". Check that ending balances and snapshot values are consistent."}
          </span>
        </div>
      )}

      {/* Pending rollovers tracker */}
      {pendingRollovers && pendingRollovers.length > 0 && (
        <div className="mb-3">
          <PendingRollovers
            pendingRollovers={pendingRollovers}
            accountRows={accountRows}
            masterAccounts={masterAccounts}
            onMutated={() => utils.performance.computeSummary.invalidate()}
          />
        </div>
      )}

      {canEdit && currentYear && (
        <SlidePanel
          isOpen={showUpdatePerformance}
          onClose={() => setShowUpdatePerformance(false)}
          title={`Update Performance (${currentYear})`}
        >
          <UpdatePerformanceForm
            currentYear={currentYear}
            accountRows={accountRows}
            onClose={() => setShowUpdatePerformance(false)}
            onSaved={() => {
              setShowUpdatePerformance(false);
              utils.performance.computeSummary.invalidate();
            }}
          />
        </SlidePanel>
      )}

      {!useCustomFilter && (
        <>
          <div className="flex items-center justify-between mb-1">
            <CategoryTabs
              accountTypeCategories={accountTypeCategories ?? []}
              parentCategories={parentCategories ?? []}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
            />
            <button
              onClick={() => setUseCustomFilter(true)}
              className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors whitespace-nowrap"
              title="Switch to picking specific accounts and a custom year range, instead of a preset category"
            >
              Filter by Account &amp; Year →
            </button>
          </div>

          <PerformanceTable
            filtered={filtered}
            accountRows={accountRows}
            masterAccounts={masterAccounts}
            activeCategory={activeCategory}
            expandedYears={expandedYears}
            onToggleYear={(year) =>
              setExpandedYears((prev) => {
                const next = new Set(prev);
                if (next.has(year)) next.delete(year);
                else next.add(year);
                return next;
              })
            }
            editingCell={editingCell}
            editValue={editValue}
            onStartEdit={startEdit}
            onEditValueChange={setEditValue}
            onSaveEdit={saveEdit}
            onKeyDown={handleKeyDown}
            canEdit={canEdit && !tableLocked}
            locked={tableLocked}
            onToggleLock={canEdit ? () => setTableLocked((l) => !l) : undefined}
          />
        </>
      )}

      {useCustomFilter && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted uppercase tracking-wide font-medium">
                  Accounts
                </span>
                <AccountPicker
                  masterAccounts={typedMasterAccounts}
                  selectedAccountIds={selectedAccountIds}
                  onChange={setSelectedAccountIds}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted uppercase tracking-wide font-medium">
                  Years
                </span>
                <YearRangePicker
                  minYear={minYear}
                  maxYear={maxYear}
                  currentYear={currentYear ?? nowYear}
                  value={yearRange}
                  onChange={setYearRange}
                />
              </div>
              <TabGroup
                label="By Account"
                helpText="Select every account of a given type"
                categories={accountTypeQuickSelects.map((o) => o.label)}
                activeCategory={activeQuickSelect}
                onCategoryChange={onQuickSelectChange}
              />
              <TabGroup
                label="Rollup"
                helpText="Select the full account set behind a rollup"
                categories={rollupQuickSelects.map((o) => o.label)}
                activeCategory={activeQuickSelect}
                onCategoryChange={onQuickSelectChange}
              />
            </div>
            <button
              onClick={() => setUseCustomFilter(false)}
              className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors whitespace-nowrap"
              title="Switch back to the preset category/rollup view (Since Inception, all accounts by type)"
            >
              ← Back to Category View
            </button>
          </div>

          {isMultiYearRange && (
            <FilteredSummary
              chained={chained}
              totalYears={effectiveYearRange.end - effectiveYearRange.start + 1}
              endingBalance={filteredEndingBalance}
              totalGainLoss={filteredTotalGainLoss}
            />
          )}

          <FilteredAccountTable rows={filteredYearRows} />
        </div>
      )}

      {showFinalizeModal && currentYear && (
        <FinalizeYearModal
          year={currentYear}
          rows={annualRows.filter(
            (r) =>
              r.year === currentYear && r.category !== PERF_CATEGORY_PORTFOLIO,
          )}
          onConfirm={(overrides) => {
            // Compute Portfolio override as sum of category overrides
            const portfolioOverride = {
              category: PERF_CATEGORY_PORTFOLIO as PerfCategory,
              beginningBalance: overrides
                .reduce((s, o) => s + parseFloat(o.beginningBalance), 0)
                .toFixed(2),
              totalContributions: overrides
                .reduce((s, o) => s + parseFloat(o.totalContributions), 0)
                .toFixed(2),
              yearlyGainLoss: overrides
                .reduce((s, o) => s + parseFloat(o.yearlyGainLoss), 0)
                .toFixed(2),
              endingBalance: overrides
                .reduce((s, o) => s + parseFloat(o.endingBalance), 0)
                .toFixed(2),
              employerContributions: overrides
                .reduce((s, o) => s + parseFloat(o.employerContributions), 0)
                .toFixed(2),
              distributions: overrides
                .reduce((s, o) => s + parseFloat(o.distributions), 0)
                .toFixed(2),
              fees: overrides
                .reduce((s, o) => s + parseFloat(o.fees), 0)
                .toFixed(2),
              rollovers: overrides
                .reduce((s, o) => s + parseFloat(o.rollovers), 0)
                .toFixed(2),
              lifetimeGains: overrides
                .reduce((s, o) => s + parseFloat(o.lifetimeGains), 0)
                .toFixed(2),
              lifetimeContributions: overrides
                .reduce((s, o) => s + parseFloat(o.lifetimeContributions), 0)
                .toFixed(2),
              lifetimeMatch: overrides
                .reduce((s, o) => s + parseFloat(o.lifetimeMatch), 0)
                .toFixed(2),
            };
            finalizeYear.mutate(
              {
                year: currentYear,
                overrides: [...overrides, portfolioOverride],
              },
              { onSuccess: () => setShowFinalizeModal(false) },
            );
          }}
          onCancel={() => setShowFinalizeModal(false)}
          isPending={finalizeYear.isPending}
        />
      )}
    </div>
  );
}
