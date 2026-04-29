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
      {[2, 3, 5, 10].map((y) => (
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
  projectionYears,
  setProjectionYears,
  budgetNote,
}: {
  maxMonthlyFunding: number | null;
  totalMonthlyAllocation: number;
  projectionYears: number;
  setProjectionYears: (years: number) => void;
  budgetNote?: string;
}) {
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
    </div>
  );
}
