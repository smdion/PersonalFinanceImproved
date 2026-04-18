"use client";

/** Portfolio performance page tracking time-weighted returns across accounts and time periods. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { formatDate } from "@/lib/utils/format";
import {
  PERF_CATEGORY_PORTFOLIO,
  type PerfCategory,
} from "@/lib/config/display-labels";
import { PageHeader } from "@/components/ui/page-header";
import { SlidePanel } from "@/components/ui/slide-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import {
  LifetimeSummaryCards,
  CategoryTabs,
  PerformanceTable,
  FinalizeYearModal,
  UpdatePerformanceForm,
} from "@/components/performance";
import { PendingRollovers } from "@/components/performance/pending-rollovers";
import type { AnnualRow } from "@/components/performance/types";
import type { EditingCell } from "@/components/performance";

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
          open={showUpdatePerformance}
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

      <CategoryTabs
        accountTypeCategories={accountTypeCategories ?? []}
        parentCategories={parentCategories ?? []}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
      />

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
        canEdit={canEdit}
      />

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
