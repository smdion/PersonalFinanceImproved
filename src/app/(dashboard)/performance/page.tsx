"use client";

/** Portfolio performance page tracking time-weighted returns across accounts and time periods. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { confirm } from "@/components/ui/confirm-dialog";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { formatDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import {
  LifetimeSummaryCards,
  CategoryTabs,
  PerformanceTable,
  FinalizeYearModal,
} from "@/components/performance";
import type { EditingCell } from "@/components/performance";

export default function PerformancePage() {
  const user = useUser();
  const canEdit = hasPermission(user, "performance");
  const { data, isLoading, error } = trpc.performance.computeSummary.useQuery();
  const utils = trpc.useUtils();
  const [activeCategory, setActiveCategory] = useState("Portfolio");
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [showAddAccount, setShowAddAccount] = useState<number | null>(null);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  const updateAnnual = trpc.performance.updateAnnual.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });
  const updateAccount = trpc.performance.updateAccount.useMutation({
    onSuccess: () => utils.performance.computeSummary.invalidate(),
  });
  const createAccount = trpc.performance.createAccount.useMutation({
    onSuccess: () => {
      utils.performance.computeSummary.invalidate();
      setShowAddAccount(null);
    },
  });
  const deleteAccount = trpc.performance.deleteAccount.useMutation({
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
    annualRows,
    accountRows,
    masterAccounts,
    lifetimeTotals,
    lastSnapshotDate,
    performanceLastUpdated,
  } = data;
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

  async function handleDeleteAccount(id: number, label: string) {
    if (
      await confirm(
        `Delete account"${label}" from this year? This cannot be undone.`,
      )
    ) {
      deleteAccount.mutate({ id });
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
        )}
      </PageHeader>

      {lifetimeTotals && (
        <LifetimeSummaryCards
          totals={lifetimeTotals}
          snapshotDate={lastSnapshotDate}
        />
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
        expandedYear={expandedYear}
        onToggleYear={(year) =>
          setExpandedYear(expandedYear === year ? null : year)
        }
        editingCell={editingCell}
        editValue={editValue}
        onStartEdit={startEdit}
        onEditValueChange={setEditValue}
        onSaveEdit={saveEdit}
        onKeyDown={handleKeyDown}
        onDeleteAccount={handleDeleteAccount}
        showAddAccount={showAddAccount}
        onShowAddAccount={setShowAddAccount}
        onCreateAccount={(data) => createAccount.mutate(data)}
        onCancelAddAccount={() => setShowAddAccount(null)}
        isCreatingAccount={createAccount.isPending}
        canEdit={canEdit}
      />

      {showFinalizeModal && currentYear && (
        <FinalizeYearModal
          year={currentYear}
          rows={annualRows.filter(
            (r) => r.year === currentYear && r.category !== "Portfolio",
          )}
          onConfirm={(overrides) => {
            // Compute Portfolio override as sum of category overrides
            const portfolioOverride = {
              category: "Portfolio",
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
