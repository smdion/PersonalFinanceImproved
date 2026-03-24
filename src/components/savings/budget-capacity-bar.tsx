"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { PctAllocator } from "./pct-allocator";
import { GoalProjection } from "./types";

type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };
type YearlyGrowth = Record<number, YearlyGrowthEntry>;

/* ── Per-year growth editor ── */

function YearlyGrowthEditor({
  projectionYears,
  yearlyGrowth,
  setYearlyGrowth,
  basePool,
}: {
  projectionYears: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
  basePool: number;
}) {
  const startYear = new Date().getFullYear();
  // Future years only (year 1 onward)
  const years: number[] = [];
  for (let i = 1; i <= projectionYears; i++) {
    years.push(startYear + i);
  }

  const updateEntry = (yr: number, patch: Partial<YearlyGrowthEntry>) => {
    const current = yearlyGrowth[yr] ?? { type: "pct", value: 0 };
    setYearlyGrowth({ ...yearlyGrowth, [yr]: { ...current, ...patch } });
  };

  const removeEntry = (yr: number) => {
    const next = { ...yearlyGrowth };
    delete next[yr];
    setYearlyGrowth(next);
  };

  // Apply same value to all years
  const applyToAll = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) {
      next[yr] = { ...entry };
    }
    setYearlyGrowth(next);
  };

  // Compute running pool for display
  const runningPool = (yr: number): number => {
    let pool = basePool;
    for (let y = startYear + 1; y <= yr; y++) {
      const e = yearlyGrowth[y];
      if (!e || e.value === 0) continue;
      if (e.type === "pct") {
        pool = pool * (1 + e.value / 100);
      } else {
        pool = pool + e.value;
      }
    }
    return pool;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-faint font-medium uppercase tracking-wide">
          Annual Growth by Year
        </span>
        {years.length > 0 && Object.keys(yearlyGrowth).length === 0 && (
          <button
            onClick={() => applyToAll({ type: "pct", value: 3 })}
            className="text-[10px] text-blue-600 hover:text-blue-700"
          >
            Set 3% for all
          </button>
        )}
      </div>

      {years.map((yr) => {
        const entry = yearlyGrowth[yr];
        const hasEntry = entry !== undefined && entry.value !== 0;
        const projectedPool = runningPool(yr);

        return (
          <div key={yr} className="flex items-center gap-2 text-xs">
            <span className="text-faint w-10 shrink-0">{yr}</span>

            {/* Type toggle */}
            <div className="flex bg-surface-elevated rounded p-0.5">
              <button
                onClick={() => updateEntry(yr, { type: "pct" })}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  !entry || entry.type === "pct"
                    ? "bg-surface-strong text-primary"
                    : "text-faint hover:text-primary"
                }`}
              >
                %
              </button>
              <button
                onClick={() => updateEntry(yr, { type: "dollar" })}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  entry?.type === "dollar"
                    ? "bg-surface-strong text-primary"
                    : "text-faint hover:text-primary"
                }`}
              >
                $
              </button>
            </div>

            {/* Value input */}
            <div className="flex items-center gap-0.5">
              {entry?.type === "dollar" && (
                <span className="text-[10px] text-muted">+$</span>
              )}
              <input
                type="number"
                min="0"
                step={entry?.type === "dollar" ? "50" : "0.5"}
                value={entry?.value ?? ""}
                placeholder="0"
                onChange={(e) => {
                  const val =
                    e.target.value === "" ? 0 : Number(e.target.value);
                  updateEntry(yr, { value: val });
                }}
                className="w-16 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-right tabular-nums"
              />
              {(!entry || entry.type === "pct") && (
                <span className="text-[10px] text-muted">%</span>
              )}
              {entry?.type === "dollar" && (
                <span className="text-[10px] text-muted">/mo</span>
              )}
            </div>

            {/* Projected pool */}
            <span className="text-[10px] text-muted tabular-nums">
              &rarr; {formatCurrency(projectedPool)}/mo
            </span>

            {/* Clear */}
            {hasEntry && (
              <button
                onClick={() => removeEntry(yr)}
                className="text-[10px] text-muted hover:text-faint"
                title="Remove growth for this year"
              >
                &times;
              </button>
            )}
          </div>
        );
      })}

      {years.length > 1 && Object.keys(yearlyGrowth).length > 0 && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => {
              // Copy first entry to all years
              const first = yearlyGrowth[years[0]!];
              if (first) applyToAll(first);
            }}
            className="text-[10px] text-muted hover:text-faint"
          >
            Apply first to all
          </button>
          <button
            onClick={() => setYearlyGrowth({})}
            className="text-[10px] text-muted hover:text-red-600"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Projection controls: year range, growth editor, % allocator toggle ── */

function ProjectionToolbar({
  projectionYears,
  setProjectionYears,
  yearlyGrowth,
  setYearlyGrowth,
  basePool,
  showPctAllocator,
  setShowPctAllocator,
}: {
  projectionYears: number;
  setProjectionYears: (y: number) => void;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
  basePool: number;
  showPctAllocator: boolean;
  setShowPctAllocator: (v: boolean) => void;
}) {
  const [showGrowth, setShowGrowth] = useState(false);
  const growthCount = Object.values(yearlyGrowth).filter(
    (e) => e.value !== 0,
  ).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

        <button
          onClick={() => setShowGrowth(!showGrowth)}
          className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
            showGrowth
              ? "bg-blue-600 text-white"
              : "bg-surface-elevated text-faint hover:bg-surface-strong"
          }`}
        >
          Annual Growth
          {growthCount > 0 && (
            <span className="bg-blue-500 text-white text-[9px] rounded-full px-1">
              {growthCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setShowPctAllocator(!showPctAllocator)}
          className={`px-2 py-0.5 text-xs rounded ${
            showPctAllocator
              ? "bg-blue-600 text-white"
              : "bg-surface-elevated text-faint hover:bg-surface-strong"
          }`}
        >
          % Allocator
        </button>
      </div>

      {showGrowth && (
        <div className="bg-surface-elevated/30 rounded-lg p-3">
          <YearlyGrowthEditor
            projectionYears={projectionYears}
            yearlyGrowth={yearlyGrowth}
            setYearlyGrowth={setYearlyGrowth}
            basePool={basePool}
          />
        </div>
      )}
    </div>
  );
}

/* ── Main BudgetCapacityBar ── */

export function BudgetCapacityBar({
  maxMonthlyFunding,
  totalMonthlyAllocation,
  budgetData,
  budgetColumn,
  setBudgetColumn,
  projectionYears,
  setProjectionYears,
  yearlyGrowth,
  setYearlyGrowth,
  budgetNote,
  goalProjections,
  onGoalUpdate,
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
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
  budgetNote?: string;
  goalProjections: GoalProjection[];
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  crossModeCapacity?: { label: string; amount: number | null }[];
}) {
  const [showPctAllocator, setShowPctAllocator] = useState(false);
  const basePool = maxMonthlyFunding ?? totalMonthlyAllocation;

  const hasMultipleBudgets =
    budgetData?.columnLabels && budgetData.columnLabels.length > 1;
  const hasSingleBudget =
    budgetData?.columnLabels &&
    budgetData.columnLabels.length === 1 &&
    budgetData.result;

  return (
    <div className="bg-surface-primary rounded-lg border p-3 sm:p-4">
      {/* Top row: budget selector + projection controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {hasMultipleBudgets && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-faint">Budget:</span>
              <div className="flex bg-surface-elevated rounded-lg p-0.5">
                {budgetData!.columnLabels!.map((label: string, idx: number) => (
                  <button
                    key={label}
                    onClick={() => setBudgetColumn(idx)}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      budgetColumn === idx
                        ? "bg-surface-strong text-primary shadow-sm font-medium"
                        : "text-faint hover:text-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-muted ml-1">
                ({formatCurrency(budgetData!.result?.totalMonthly ?? 0)}/mo)
              </span>
            </div>
          )}
          {hasSingleBudget && (
            <span className="text-xs text-faint">
              Budget: {budgetData!.columnLabels![0]} &mdash;{" "}
              {formatCurrency(budgetData!.result!.totalMonthly)}/mo
            </span>
          )}
        </div>

        <ProjectionToolbar
          projectionYears={projectionYears}
          setProjectionYears={setProjectionYears}
          yearlyGrowth={yearlyGrowth}
          setYearlyGrowth={setYearlyGrowth}
          basePool={basePool}
          showPctAllocator={showPctAllocator}
          setShowPctAllocator={setShowPctAllocator}
        />
      </div>

      {/* Capacity bar */}
      {maxMonthlyFunding !== null && (
        <div
          className={`px-3 py-2 rounded-lg text-sm flex items-center justify-between ${
            totalMonthlyAllocation > maxMonthlyFunding
              ? "bg-red-50 border border-red-200"
              : "bg-green-50 border border-green-200"
          }`}
        >
          <div className="flex items-center gap-4">
            <span className="text-faint">
              Budget leftover:{" "}
              <HelpTip
                text={`Based on regular monthly pay (${budgetNote ?? "2 paychecks/month for biweekly"}). Extra paycheck months are not included.`}
              />
              <span className="font-semibold text-primary">
                {formatCurrency(maxMonthlyFunding)}
              </span>
              /mo
            </span>
            <span className="text-muted">|</span>
            <span className="text-faint">
              Allocated:{" "}
              <span className="font-semibold text-primary">
                {formatCurrency(totalMonthlyAllocation)}
              </span>
              /mo
            </span>
          </div>
          <span
            className={`font-semibold ${
              totalMonthlyAllocation > maxMonthlyFunding
                ? "text-red-600"
                : "text-green-600"
            }`}
          >
            {totalMonthlyAllocation > maxMonthlyFunding
              ? `Over by ${formatCurrency(totalMonthlyAllocation - maxMonthlyFunding)}`
              : `${formatCurrency(maxMonthlyFunding - totalMonthlyAllocation)} unallocated`}
          </span>
        </div>
      )}

      {/* Cross-mode capacity comparison */}
      {crossModeCapacity && crossModeCapacity.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-faint font-medium">By mode:</span>
          {crossModeCapacity.map((mode, index) => (
            <span
              key={mode.label}
              className={`tabular-nums ${
                index === budgetColumn
                  ? "text-primary font-semibold"
                  : "text-muted"
              }`}
            >
              {mode.label}:{" "}
              {mode.amount !== null ? formatCurrency(mode.amount) : "—"}
              /mo
            </span>
          ))}
        </div>
      )}

      {/* Percentage Allocator (collapsible) */}
      {showPctAllocator && (
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-blue-300">
              Percentage Allocator &mdash; set a total pool and distribute by %
            </p>
            <button
              onClick={() => setShowPctAllocator(false)}
              className="text-xs text-muted hover:text-faint"
            >
              Close
            </button>
          </div>
          <PctAllocator
            goals={goalProjections}
            defaultPool={maxMonthlyFunding ?? totalMonthlyAllocation}
            onApply={(allocations) => {
              for (const { goalId, amount } of allocations) {
                onGoalUpdate(
                  goalId,
                  "monthlyContribution",
                  String(Math.round(amount)),
                );
              }
              setShowPctAllocator(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
