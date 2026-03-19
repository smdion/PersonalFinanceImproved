"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface OverrideRange {
  startMonth: string;
  endMonth: string;
  amount: number;
  monthCount: number;
}

interface AllocationOverride {
  goalId: number;
  monthDate: string;
  amount: number;
}

/** Collapse overrides into contiguous ranges with the same amount */
function collapseOverrides(overrides: AllocationOverride[]): OverrideRange[] {
  if (overrides.length === 0) return [];

  const sorted = [...overrides].sort((a, b) =>
    a.monthDate.localeCompare(b.monthDate),
  );
  const ranges: OverrideRange[] = [];

  let rangeStart = sorted[0]!;
  let rangeEnd = sorted[0]!;
  let count = 1;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const prevDate = new Date(rangeEnd.monthDate + "T00:00:00");
    const currDate = new Date(current.monthDate + "T00:00:00");

    // Check if contiguous (next month) and same amount
    const nextMonth = new Date(
      prevDate.getFullYear(),
      prevDate.getMonth() + 1,
      1,
    );
    const isContiguous =
      currDate.getFullYear() === nextMonth.getFullYear() &&
      currDate.getMonth() === nextMonth.getMonth();
    const sameAmount = current.amount === rangeStart.amount;

    if (isContiguous && sameAmount) {
      rangeEnd = current;
      count++;
    } else {
      ranges.push({
        startMonth: rangeStart.monthDate,
        endMonth: rangeEnd.monthDate,
        amount: rangeStart.amount,
        monthCount: count,
      });
      rangeStart = current;
      rangeEnd = current;
      count = 1;
    }
  }

  ranges.push({
    startMonth: rangeStart.monthDate,
    endMonth: rangeEnd.monthDate,
    amount: rangeStart.amount,
    monthCount: count,
  });

  return ranges;
}

function formatMonthShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatRangeLabel(range: OverrideRange): string {
  if (range.startMonth === range.endMonth) {
    return formatMonthShort(range.startMonth);
  }
  const startDate = new Date(range.startMonth + "T00:00:00");
  const endDate = new Date(range.endMonth + "T00:00:00");
  if (startDate.getFullYear() === endDate.getFullYear()) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[startDate.getMonth()]}\u2013${months[endDate.getMonth()]} ${startDate.getFullYear()}`;
  }
  return `${formatMonthShort(range.startMonth)}\u2013${formatMonthShort(range.endMonth)}`;
}

export function FundOverridesSummary({
  overrides,
  goalId,
  defaultAllocation,
  onDeleteOverride,
  onEditMonth,
  canEdit,
}: {
  overrides: AllocationOverride[];
  goalId: number;
  defaultAllocation: number;
  onDeleteOverride: (params: { goalId: number; monthDate: string }) => void;
  onEditMonth: (monthDate: Date) => void;
  canEdit?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const goalOverrides = overrides.filter((o) => o.goalId === goalId);
  const ranges = collapseOverrides(goalOverrides);

  if (ranges.length === 0 && canEdit === false) return null;

  const handleClearRange = (range: OverrideRange) => {
    // Delete all overrides in this range
    const start = new Date(range.startMonth + "T00:00:00");
    const end = new Date(range.endMonth + "T00:00:00");
    const d = new Date(start);
    while (d <= end) {
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      onDeleteOverride({ goalId, monthDate: mk });
      d.setMonth(d.getMonth() + 1);
    }
  };

  return (
    <div className="border-t pt-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-primary"
        >
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          Monthly Overrides ({ranges.length})
        </button>
        {canEdit !== false && (
          <button
            onClick={() => {
              // Open the month editor modal for the next upcoming month
              onEditMonth(new Date());
            }}
            className="text-[10px] text-blue-600 hover:text-blue-700"
          >
            + Add
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-2 space-y-1.5">
          {ranges.length === 0 && (
            <p className="text-xs text-muted py-1">
              No overrides. Default: {formatCurrency(defaultAllocation)}/mo
            </p>
          )}

          {ranges.map((range, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs py-1 px-2 bg-surface-elevated rounded"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const d = new Date(range.startMonth + "T00:00:00");
                    onEditMonth(d);
                  }}
                  className="text-blue-600 font-medium hover:text-blue-700 underline underline-offset-2"
                >
                  {formatRangeLabel(range)}
                </button>
                <span className="text-secondary">
                  {formatCurrency(range.amount)}/mo
                </span>
                {range.amount === 0 && (
                  <span className="text-yellow-500 text-[10px]">(paused)</span>
                )}
                <span className="text-muted text-[10px]">
                  default: {formatCurrency(defaultAllocation)}
                </span>
              </div>
              {canEdit !== false && (
                <button
                  onClick={() => handleClearRange(range)}
                  className="text-muted hover:text-red-600 text-[10px]"
                  title="Reset to default"
                >
                  clear
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
