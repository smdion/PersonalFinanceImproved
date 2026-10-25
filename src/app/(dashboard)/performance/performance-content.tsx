"use client";

/** Performance page client content — time-weighted returns across accounts
 *  and time periods. The default-export Page in performance/page.tsx is a
 *  thin server component that prefetches the heavy queries before rendering
 *  this. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";
import {
  accountDisplayName,
  formatCurrency,
  formatDate,
} from "@/lib/utils/format";
import {
  findBasisGaps,
  findMissingCostBasis,
} from "@/lib/pure/basis-consistency";
import { parseBasisEditField } from "@/components/performance/basis-cell";
import {
  PERF_CATEGORY_PORTFOLIO,
  accountTypeToPerformanceCategory,
  type PerfCategory,
} from "@/lib/config/display-labels";
import { isInRetirementPerformanceRollup } from "@/lib/config/account-types";
import { PageHeader } from "@/components/ui/page-header";
import { SlidePanel } from "@/components/ui/slide-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { sumBy } from "@/lib/utils/math";
import { RealizedVsAssumedCard } from "@/components/performance/realized-vs-assumed-card";
import {
  LifetimeSummaryCards,
  CategoryTabs,
  TabGroup,
  PerformanceTable,
  FinalizeYearModal,
  UpdatePerformanceForm,
  UpdateBasisForm,
  AccountPicker,
  YearRangePicker,
  FilteredSummary,
  FilteredAccountTable,
} from "@/components/performance";
import type { YearRange } from "@/components/performance";
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

export function PerformanceContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "performance");
  const { data, isLoading, error } = trpc.performance.computeSummary.useQuery();
  const { data: freshness } = trpc.settings.getDataFreshness.useQuery();
  const utils = trpc.useUtils();
  const [activeCategory, setActiveCategory] = useState(PERF_CATEGORY_PORTFOLIO);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [showUpdatePerformance, setShowUpdatePerformance] = useState(false);
  const [showUpdateBasis, setShowUpdateBasis] = useState(false);
  const [tableLocked, setTableLocked] = useState(true);
  // Basis columns are hidden by default — most views don't need them, and
  // they add width to every row.
  const [showBasisColumn, setShowBasisColumn] = usePersistedSetting<boolean>(
    "performance_show_basis_column",
    false,
  );
  const [showUnrealizedColumn, setShowUnrealizedColumn] =
    usePersistedSetting<boolean>("performance_show_unrealized_column", false);
  const [onlyBasisColumn, setOnlyBasisColumn] = usePersistedSetting<boolean>(
    "performance_only_basis_column",
    false,
  );

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
  // Reuses Tax Buckets' own mutation (not a second write path for the same
  // account_basis row) — this table and Tax Buckets edit the same figure.
  const updateRothBasis = trpc.taxBuckets.updateRothBasis.useMutation({
    onSuccess: () => {
      utils.performance.computeSummary.invalidate();
      utils.taxBuckets.computeBreakdown.invalidate();
    },
  });
  const finalizeYear = trpc.performance.finalizeYear.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });

  const {
    editingKey: editingCell,
    editValue,
    setEditValue,
    startEdit: startEditRaw,
    commit: saveEdit,
    handleKeyDown,
  } = useInlineNumberEdit<NonNullable<EditingCell>>({
    onCommit: ({ type, id, field }, value) => {
      if (type === "annual") {
        updateAnnual.mutate({ id, [field]: value });
      } else if (type === "master") {
        updateCostBasis.mutate({ performanceAccountId: id, costBasis: value });
      } else if (type === "basis") {
        // field is "<basis field>:<ownerPersonId>" — basis is per person.
        const row = data?.accountRows.find((r) => r.id === id) as
          AccountRow | undefined;
        const target = parseBasisEditField(field);
        const owner = row?.basisByOwner?.find(
          (b) => b.ownerPersonId === target?.ownerPersonId,
        );
        if (!row || row.performanceAccountId == null || !target || !owner)
          return;
        updateRothBasis.mutate({
          performanceAccountId: row.performanceAccountId,
          ownerPersonId: owner.ownerPersonId,
          year: row.year,
          contributionBasis: String(
            target.field === "contributionBasis"
              ? value
              : owner.contributionBasis,
          ),
          conversionBasis: String(
            target.field === "conversionBasis" ? value : owner.conversionBasis,
          ),
          latestConversionYear: owner.latestConversionYear,
        });
      } else {
        updateAccount.mutate({ id, [field]: value });
      }
    },
  });
  const startEdit = (
    type: "annual" | "account" | "master" | "basis",
    id: number,
    field: string,
    currentValue: number,
  ) => {
    if (!canEdit) return;
    startEditRaw({ type, id, field }, currentValue);
  };

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
      <p className="text-sm text-red-600">
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
  // isInRetirementPerformanceRollup below). Restricting the default to active-only
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
  // Portfolio = grand total of every account-type category, unconditionally.
  // Retirement's definition (401k/IRA + HSA regardless of parentCategory,
  // plus only Brokerage-category accounts tagged parentCategory===
  // "Retirement") is shared with the router via isInRetirementPerformanceRollup
  // — single source of truth, not mirrored here (audit Batch 31 Finding 1).
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
          .filter((r) =>
            isInRetirementPerformanceRollup(r.accountType, r.parentCategory),
          )
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
          .filter((m) =>
            isInRetirementPerformanceRollup(m.accountType, m.parentCategory),
          )
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

  const basisGaps = findBasisGaps(
    accountRows.flatMap((a) =>
      a.performanceAccountId === null
        ? []
        : (a.basisByOwner ?? []).map((b) => ({
            performanceAccountId: a.performanceAccountId!,
            ownerPersonId: b.ownerPersonId,
            year: a.year,
            conversionBasis: b.conversionBasis,
            latestConversionYear: b.latestConversionYear,
          })),
    ),
  );
  // Active brokerages holding money with no cost basis: the projection
  // taxes all of it as gains (0 also means "not entered"). Balance from
  // each account's latest year, so it holds before this year's row exists.
  const missingCostBasis = findMissingCostBasis(
    typedMasterAccounts
      .filter((m) => m.isActive)
      .map((m) => {
        const rows = accountRows.filter((r) => r.performanceAccountId === m.id);
        const latest = Math.max(...rows.map((r) => r.year));
        return {
          account: m,
          category: m.accountType,
          balance: sumBy(
            rows.filter((r) => r.year === latest),
            (r) => r.endingBalance,
          ),
          costBasis: Number(m.costBasis ?? 0),
        };
      }),
  );
  const basisGapLabel = (g: (typeof basisGaps)[number]) => {
    const a = accountRows.find(
      (r) => r.performanceAccountId === g.performanceAccountId,
    );
    const owner = a?.basisByOwner?.find(
      (b) => b.ownerPersonId === g.ownerPersonId,
    )?.ownerName;
    return a
      ? `${owner ? `${owner} — ` : ""}${accountDisplayName({
          institution: a.institution,
          // lint-violation-ok: passing accountLabel into the blessed accountDisplayName helper, not rendering it directly
          accountLabel: a.accountLabel,
          accountType: a.accountType ?? undefined,
          ownershipType: a.ownershipType,
        })}`
      : "An account";
  };

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
            {(performanceLastUpdated || lastSnapshotDate) &&
              freshness?.basisDate && <span>·</span>}
            {freshness?.basisDate && (
              <span>Basis updated: {formatDate(freshness.basisDate)}</span>
            )}
          </div>
        }
      >
        {canEdit && currentYear && (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={() => setShowUpdatePerformance(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              Update Performance
            </button>
            <button
              onClick={() => setShowUpdateBasis(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              Update Basis
            </button>
            <span className="inline-flex items-center gap-1">
              <button
                onClick={() => setShowFinalizeModal(true)}
                disabled={finalizeYear.isPending}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
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

      {/* Roth conversion basis entered on a later year but not its own */}
      {basisGaps.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-400/60 bg-amber-50/40 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {basisGaps.map((g) => (
            <p key={`${g.performanceAccountId}-${g.ownerPersonId}-${g.year}`}>
              {basisGapLabel(g)}: {g.year} conversion basis is{" "}
              {formatCurrency(g.recorded)}, but {g.fromYear} says the latest
              conversion was in {g.year} with {formatCurrency(g.expected)} —{" "}
              {g.year}&apos;s row is probably missing it. Turn on the Basis
              columns and fix their line on the {g.year} row.
            </p>
          ))}
        </div>
      )}

      {/* Brokerages with money and no cost basis entered */}
      {missingCostBasis.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-400/60 bg-amber-50/40 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {missingCostBasis.map(({ account, balance }) => (
            <p key={account.id}>
              {accountDisplayName(account)} holds {formatCurrency(balance)} with
              no cost basis entered, so projections tax everything drawn from it
              as capital gains. Turn on the Basis columns and enter what you
              paid on its {currentYear} row.
            </p>
          ))}
        </div>
      )}

      {/* Ending balance consistency warning */}
      {balanceMismatch && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-orange-400/60 bg-orange-50/40 px-3 py-2 text-xs text-orange-800 dark:bg-orange-950/20 dark:text-orange-300">
          <svg
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500"
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
            account totals ({formatCurrency(balanceMismatch.perfTotal)}) differ
            from portfolio snapshot ({formatCurrency(balanceMismatch.snapTotal)}
            ) by {formatCurrency(Math.abs(balanceMismatch.delta))}. Check that
            ending balances and snapshot values are consistent.
          </span>
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

      {canEdit && currentYear && (
        <SlidePanel
          isOpen={showUpdateBasis}
          onClose={() => setShowUpdateBasis(false)}
          title={`Update Basis (${currentYear})`}
        >
          <UpdateBasisForm
            currentYear={currentYear}
            accountRows={accountRows}
            onClose={() => setShowUpdateBasis(false)}
            onSaved={() => {
              setShowUpdateBasis(false);
              utils.performance.computeSummary.invalidate();
              utils.taxBuckets.computeBreakdown.invalidate();
              utils.settings.getDataFreshness.invalidate();
            }}
          />
        </SlidePanel>
      )}

      {!useCustomFilter && (
        <>
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <CategoryTabs
              accountTypeCategories={accountTypeCategories ?? []}
              parentCategories={parentCategories ?? []}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              showBasis={showBasisColumn}
              onToggleBasis={() => setShowBasisColumn(!showBasisColumn)}
              showUnrealized={showUnrealizedColumn}
              onToggleUnrealized={() =>
                setShowUnrealizedColumn(!showUnrealizedColumn)
              }
              onlyBasis={onlyBasisColumn}
              onToggleOnlyBasis={() => setOnlyBasisColumn(!onlyBasisColumn)}
            />
            <button
              onClick={() => setUseCustomFilter(true)}
              className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 whitespace-nowrap transition-colors"
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
            showBasis={showBasisColumn}
            showUnrealized={showUnrealizedColumn}
            onlyBasis={onlyBasisColumn}
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs font-medium tracking-wide uppercase">
                  Accounts
                </span>
                <AccountPicker
                  masterAccounts={typedMasterAccounts}
                  selectedAccountIds={selectedAccountIds}
                  onChange={setSelectedAccountIds}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs font-medium tracking-wide uppercase">
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
              className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 whitespace-nowrap transition-colors"
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

      {/* Actual returns vs the projections' assumption (display only) */}
      <RealizedVsAssumedCard />

      {showFinalizeModal && currentYear && (
        <FinalizeYearModal
          year={currentYear}
          rows={annualRows.filter(
            (r) =>
              r.year === currentYear && r.category !== PERF_CATEGORY_PORTFOLIO,
          )}
          accounts={accountRows.filter((a) => a.year === currentYear)}
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
