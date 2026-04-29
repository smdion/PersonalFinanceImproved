"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  PoolDistributionEditor,
  type FundAllocation,
} from "./pool-distribution-editor";
import { type GoalProjection, monthKey } from "./types";

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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

  const total = funds.reduce((s, f) => s + f.amount, 0);
  const isBalanced = Math.abs(total - localPool) < 1;

  const hasChanges =
    Math.abs(localPool - pool) >= 0.01 ||
    funds.some(
      (f) =>
        Math.abs(
          f.amount -
            (monthIndex >= 0
              ? goalProjections.find((gp) => gp.goalId === f.goalId)!
                  .monthlyAllocations[monthIndex]!
              : f.defaultAmount),
        ) >= 0.01,
    );

  const handleApply = useCallback(() => {
    if (!isBalanced) return;
    const md = formatMonthDate(monthDate);
    // Only include overrides where amount differs from default
    const allocations = funds
      .filter((f) => Math.abs(f.amount - f.defaultAmount) >= 0.01)
      .map((f) => ({ goalId: f.goalId, amount: f.amount }));

    if (allocations.length === 0) {
      // All match defaults — clear overrides for this month
      onDeleteMonthOverrides([md]);
    } else {
      onUpsertMonth({ monthDate: md, allocations });
    }
    onClose();
  }, [
    funds,
    isBalanced,
    monthDate,
    onUpsertMonth,
    onDeleteMonthOverrides,
    onClose,
  ]);

  const handleFillForward = useCallback(() => {
    if (!isBalanced) return;
    const startMd = formatMonthDate(monthDate);
    const allMds = monthDates.map((d) => formatMonthDate(d));
    const allocations = funds
      .filter((f) => Math.abs(f.amount - f.defaultAmount) >= 0.01)
      .map((f) => ({ goalId: f.goalId, amount: f.amount }));

    if (allocations.length === 0) {
      // Clear all overrides from this month forward
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
    isBalanced,
    monthDate,
    monthDates,
    onUpsertMonthRange,
    onDeleteMonthOverrides,
    onClose,
  ]);

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
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-primary border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div>
              <h2 className="text-base font-semibold text-primary">
                Edit Month &mdash; {monthLabel}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Distribute the savings pool across funds. All allocations must
                sum to the pool total.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-faint hover:text-secondary text-xl px-2 -mr-2"
              title="Close"
            >
              &times;
            </button>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <PoolDistributionEditor
              pool={localPool}
              funds={funds}
              onChange={setFunds}
              poolEditable
              onPoolChange={setLocalPool}
            />
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-3 flex flex-col gap-2">
            {/* Reset row */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleReset}
                disabled={!thisMonthHasOverrides}
                className="text-xs text-muted hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove all overrides for this month"
              >
                Reset this month
              </button>
              <button
                onClick={handleResetForward}
                disabled={!hasOverridesFromHere}
                className="text-xs text-muted hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove all overrides from this month to the end of projections"
              >
                Reset this month forward
              </button>
            </div>
            {/* Action row */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs border border-strong text-muted rounded-lg hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                onClick={handleFillForward}
                disabled={!isBalanced || !hasChanges}
                className="px-3 py-1.5 text-xs bg-surface-strong text-secondary rounded-lg hover:bg-surface-strong disabled:opacity-40 disabled:cursor-not-allowed"
                title="Apply this distribution from this month to the end of projections"
              >
                Fill forward
              </button>
              <button
                onClick={handleApply}
                disabled={!isBalanced || !hasChanges}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
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
