"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  PoolDistributionEditor,
  type FundAllocation,
} from "./pool-distribution-editor";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { type GoalProjection, monthKey } from "./types";
import { monthKey as fullMonthKey } from "@/lib/pure/date-keys";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMonthDate(d: Date) {
  return fullMonthKey(d);
}

interface MonthOverrideModalProps {
  monthDate: Date;
  monthDates: Date[];
  goalProjections: GoalProjection[];
  pool: number;
  onUpsertMonth: (params: {
    monthDate: string;
    allocations: { goalId: number; amount: number }[];
  }) => void;
  onUpsertMonthRange: (params: {
    startMonth: string;
    endMonth: string | null;
    monthDates: string[];
    allocations: { goalId: number; amount: number }[];
  }) => void;
  onDeleteMonthOverrides: (monthDates: string[]) => void;
  onClose: () => void;
}

export function MonthOverrideModal({
  monthDate,
  monthDates,
  goalProjections,
  pool,
  onUpsertMonth,
  onUpsertMonthRange,
  onDeleteMonthOverrides,
  onClose,
}: MonthOverrideModalProps) {
  const monthIndex = monthDates.findIndex(
    (d) => monthKey(d) === monthKey(monthDate),
  );

  // Build initial fund allocations from current projections for this month
  const initialFunds = useMemo<FundAllocation[]>(() => {
    return goalProjections.map((gp, i) => ({
      goalId: gp.goalId,
      name: gp.name,
      defaultAmount: gp.monthlyAllocation,
      amount:
        monthIndex >= 0
          ? gp.monthlyAllocations[monthIndex]!
          : gp.monthlyAllocation,
      colorIndex: i,
    }));
  }, [goalProjections, monthIndex]);

  const [funds, setFunds] = useState<FundAllocation[]>(initialFunds);
  const [localPool, setLocalPool] = useState(pool);
  const [pendingApply, setPendingApply] = useState(false);
  const [pendingFillForward, setPendingFillForward] = useState(false);
  const [showAddFunds, setShowAddFunds] = useState(false);

  // Which funds are shown in the editor — start with funds that have non-zero allocations
  const [visibleFundIds, setVisibleFundIds] = useState<Set<number>>(() => {
    const activeIds = new Set(
      initialFunds.filter((f) => f.amount > 0).map((f) => f.goalId),
    );
    // If nothing is active, show everything so the modal isn't empty
    return activeIds.size > 0
      ? activeIds
      : new Set(initialFunds.map((f) => f.goalId));
  });

  const visibleFunds = funds.filter((f) => visibleFundIds.has(f.goalId));
  const hiddenFunds = funds.filter((f) => !visibleFundIds.has(f.goalId));

  const total = sumBy(visibleFunds, (f) => f.amount);
  const isOverAllocated = total > localPool + 1;
  const isUnderAllocated = total < localPool - 1;

  // Wrap setters to clear confirmation state on any allocation/pool change.
  // PoolDistributionEditor receives only the visible subset, so merge updates back
  // into the full funds array (hidden funds retain their values unchanged).
  const handleFundsChange = useCallback((updatedVisible: FundAllocation[]) => {
    setFunds((prev) =>
      prev.map((f) => {
        const updated = updatedVisible.find((u) => u.goalId === f.goalId);
        return updated ?? f;
      }),
    );
    setPendingApply(false);
    setPendingFillForward(false);
  }, []);

  const handlePoolChange = useCallback((newPool: number) => {
    setLocalPool(newPool);
    setPendingApply(false);
    setPendingFillForward(false);
  }, []);

  const hasChanges = visibleFunds.some(
    (f) =>
      Math.abs(
        f.amount -
          (monthIndex >= 0
            ? goalProjections.find((gp) => gp.goalId === f.goalId)!
                .monthlyAllocations[monthIndex]!
            : f.defaultAmount),
      ) >= 0.01,
  );

  const doApply = useCallback(() => {
    const md = formatMonthDate(monthDate);
    const allocations = funds
      .filter((f) => Math.abs(f.amount - f.defaultAmount) >= 0.01)
      .map((f) => ({ goalId: f.goalId, amount: f.amount }));

    if (allocations.length === 0) {
      onDeleteMonthOverrides([md]);
    } else {
      onUpsertMonth({ monthDate: md, allocations });
    }
    onClose();
  }, [funds, monthDate, onUpsertMonth, onDeleteMonthOverrides, onClose]);

  const doFillForward = useCallback(() => {
    const startMd = formatMonthDate(monthDate);
    const allMds = monthDates.map((d) => formatMonthDate(d));
    const allocations = funds
      .filter((f) => Math.abs(f.amount - f.defaultAmount) >= 0.01)
      .map((f) => ({ goalId: f.goalId, amount: f.amount }));

    if (allocations.length === 0) {
      onDeleteMonthOverrides(allMds.filter((m) => m >= startMd));
    } else {
      onUpsertMonthRange({
        startMonth: startMd,
        endMonth: null,
        monthDates: allMds,
        allocations,
      });
    }
    onClose();
  }, [
    funds,
    monthDate,
    monthDates,
    onUpsertMonthRange,
    onDeleteMonthOverrides,
    onClose,
  ]);

  const handleApply = useCallback(() => {
    if (isOverAllocated) return;
    if (isUnderAllocated && !pendingApply) {
      setPendingApply(true);
      return;
    }
    doApply();
  }, [isOverAllocated, isUnderAllocated, pendingApply, doApply]);

  const handleFillForward = useCallback(() => {
    if (isOverAllocated) return;
    if (isUnderAllocated && !pendingFillForward) {
      setPendingFillForward(true);
      return;
    }
    doFillForward();
  }, [isOverAllocated, isUnderAllocated, pendingFillForward, doFillForward]);

  const handleReset = useCallback(() => {
    const md = formatMonthDate(monthDate);
    onDeleteMonthOverrides([md]);
    onClose();
  }, [monthDate, onDeleteMonthOverrides, onClose]);

  const handleResetForward = useCallback(() => {
    const startMd = formatMonthDate(monthDate);
    const allMds = monthDates.map((d) => formatMonthDate(d));
    onDeleteMonthOverrides(allMds.filter((m) => m >= startMd));
    onClose();
  }, [monthDate, monthDates, onDeleteMonthOverrides, onClose]);

  // Check if any month from here forward has overrides
  const hasOverridesFromHere = useMemo(() => {
    if (monthIndex < 0) return false;
    return goalProjections.some((gp) =>
      gp.hasOverride.slice(monthIndex).some(Boolean),
    );
  }, [goalProjections, monthIndex]);

  // Check if this specific month has overrides
  const thisMonthHasOverrides = useMemo(() => {
    if (monthIndex < 0) return false;
    return goalProjections.some((gp) => gp.hasOverride[monthIndex]);
  }, [goalProjections, monthIndex]);

  const monthLabel = `${MONTH_NAMES[monthDate.getMonth()]} 1, ${monthDate.getFullYear()}`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-primary flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-primary text-base font-semibold">
                Edit Month &mdash; {monthLabel}
              </h2>
              <p className="text-muted mt-0.5 text-xs">
                Distribute the savings pool across funds. Allocations can be
                less than the pool — any unallocated amount is treated as going
                elsewhere.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-faint hover:text-secondary -mr-2 px-2 text-xl"
              title="Close"
            >
              &times;
            </button>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <PoolDistributionEditor
              pool={localPool}
              funds={visibleFunds}
              onChange={handleFundsChange}
              poolEditable
              onPoolChange={handlePoolChange}
            />

            {/* Hidden (zero-allocation) funds — expandable */}
            {hiddenFunds.length > 0 && (
              <div>
                <button
                  onClick={() => setShowAddFunds((v) => !v)}
                  className="text-muted hover:text-secondary flex items-center gap-1 text-xs transition-colors"
                >
                  <span>{showAddFunds ? "▾" : "▸"}</span>
                  <span>
                    {showAddFunds ? "Hide" : "Add fund"} ({hiddenFunds.length}{" "}
                    with $0 allocation)
                  </span>
                </button>

                {showAddFunds && (
                  <div className="mt-2 space-y-1.5 pl-1">
                    {hiddenFunds.map((f) => (
                      <div
                        key={f.goalId}
                        className="border-strong flex items-center justify-between rounded-lg border border-dashed px-3 py-2"
                      >
                        <span className="text-muted text-sm">{f.name}</span>
                        <button
                          onClick={() => {
                            setVisibleFundIds(
                              (prev) => new Set([...prev, f.goalId]),
                            );
                            setShowAddFunds(false);
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-2 border-t px-5 py-3">
            {/* Under-allocation confirmation panel */}
            {(pendingApply || pendingFillForward) && (
              <div className="bg-surface-elevated border-strong flex flex-col gap-2 rounded-lg border border-l-2 border-l-amber-500 px-3 py-2.5">
                <p className="text-secondary text-xs">
                  <span className="font-semibold text-amber-400">
                    {formatCurrency(localPool - total)}
                  </span>{" "}
                  of the {formatCurrency(localPool)}/mo pool is unallocated.{" "}
                  {pendingFillForward
                    ? `Fill forward will apply this to all months from ${monthLabel} onward.`
                    : `This applies to ${monthLabel} only.`}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setPendingApply(false);
                      setPendingFillForward(false);
                    }}
                    className="border-strong text-muted hover:bg-surface-sunken rounded-lg border px-3 py-1.5 text-xs"
                  >
                    Go back
                  </button>
                  <button
                    onClick={pendingFillForward ? doFillForward : doApply}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-400"
                  >
                    {pendingFillForward
                      ? "Fill forward anyway"
                      : "Apply anyway"}
                  </button>
                </div>
              </div>
            )}

            {/* Reset row */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleReset}
                disabled={!thisMonthHasOverrides}
                className="text-muted text-xs transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                title="Remove all overrides for this month"
              >
                Reset this month
              </button>
              <button
                onClick={handleResetForward}
                disabled={!hasOverridesFromHere}
                className="text-muted text-xs transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                title="Remove all overrides from this month to the end of projections"
              >
                Reset this month forward
              </button>
            </div>
            {/* Action row */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="border-strong text-muted hover:bg-surface-sunken rounded-lg border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleFillForward}
                disabled={isOverAllocated || !hasChanges}
                className="bg-surface-strong text-secondary hover:bg-surface-strong rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                title="Apply this distribution from this month to the end of projections"
              >
                Fill forward
              </button>
              <button
                onClick={handleApply}
                disabled={isOverAllocated || !hasChanges}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply this month
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
