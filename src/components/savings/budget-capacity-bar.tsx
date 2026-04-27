"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";

function YearRangeSelector({
  projectionYears,
  setProjectionYears,
}: {
  projectionYears: number;
  setProjectionYears: (y: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[2, 3, 5].map((y) => (
        <button
          key={y}
          onClick={() => setProjectionYears(y)}
          className={`px-2 py-0.5 text-xs rounded ${
            projectionYears === y
              ? "bg-blue-600 text-white"
              : "bg-surface-elevated text-faint hover:bg-surface-strong"
          }`}
        >
          {y}yr
        </button>
      ))}
    </div>
  );
}

export function BudgetCapacityBar({
  maxMonthlyFunding,
  totalMonthlyAllocation,
  budgetData,
  budgetColumn,
  setBudgetColumn,
  projectionYears,
  setProjectionYears,
  budgetNote,
  crossModeCapacity,
}: {
  maxMonthlyFunding: number | null;
  totalMonthlyAllocation: number;
  budgetData:
    | {
        columnLabels?: string[];
        result?: { totalMonthly: number } | null;
      }
    | undefined;
  budgetColumn: number;
  setBudgetColumn: (col: number) => void;
  projectionYears: number;
  setProjectionYears: (years: number) => void;
  budgetNote?: string;
  crossModeCapacity?: { label: string; amount: number | null }[];
}) {
  const hasMultipleBudgets =
    budgetData?.columnLabels && budgetData.columnLabels.length > 1;

  const isOver =
    maxMonthlyFunding !== null && totalMonthlyAllocation > maxMonthlyFunding;
  const delta =
    maxMonthlyFunding !== null
      ? Math.abs(maxMonthlyFunding - totalMonthlyAllocation)
      : null;

  return (
    <div className="space-y-1">
      {/* Single-line toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {/* Budget mode selector */}
        {hasMultipleBudgets && (
          <div className="flex items-center gap-2">
            <span className="text-faint">Budget:</span>
            <div className="flex bg-surface-elevated rounded-lg p-0.5">
              {budgetData!.columnLabels!.map((label: string, idx: number) => (
                <button
                  key={label}
                  onClick={() => setBudgetColumn(idx)}
                  className={`px-2.5 py-1 rounded-md transition-colors text-xs ${
                    budgetColumn === idx
                      ? "bg-surface-strong text-primary shadow-sm font-medium"
                      : "text-faint hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Year range */}
        <div className="flex items-center gap-2">
          <span className="text-faint">Projection:</span>
          <YearRangeSelector
            projectionYears={projectionYears}
            setProjectionYears={setProjectionYears}
          />
        </div>

        {/* Capacity signal */}
        {maxMonthlyFunding !== null && (
          <div className="flex items-center gap-1.5 text-faint">
            <HelpTip
              text={`Based on regular monthly pay (${budgetNote ?? "2 paychecks/month for biweekly"}). Extra paycheck months not included.`}
            />
            <span>
              {formatCurrency(totalMonthlyAllocation)} allocated of{" "}
              {formatCurrency(maxMonthlyFunding)} available
            </span>
            <span className="text-strong">·</span>
            <span
              className={`font-semibold ${isOver ? "text-red-500" : "text-green-600"}`}
            >
              {isOver
                ? `${formatCurrency(delta!)} over`
                : `${formatCurrency(delta!)} left`}
            </span>
          </div>
        )}
      </div>

      {/* Cross-mode comparison — second line, only when multiple modes */}
      {crossModeCapacity && crossModeCapacity.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint pl-0.5">
          <span className="font-medium">By mode:</span>
          {crossModeCapacity.map((mode, index) => (
            <span
              key={mode.label}
              className={
                index === budgetColumn ? "text-primary font-semibold" : ""
              }
            >
              {mode.label}:{" "}
              {mode.amount !== null ? formatCurrency(mode.amount) : "—"}
              /mo
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
