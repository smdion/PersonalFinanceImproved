"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { ContributionGrid } from "./contribution-grid";
import { MonthOverrideModal } from "./month-override-modal";
import { PctAllocator } from "./pct-allocator";
import type { GoalProjection } from "./types";

type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };
type YearlyGrowth = Record<number, YearlyGrowthEntry>;

/* ── Per-year growth editor (moved from BudgetCapacityBar) ── */

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

  const applyToAll = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) next[yr] = { ...entry };
    setYearlyGrowth(next);
  };

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
            <span className="text-[10px] text-muted tabular-nums">
              &rarr; {formatCurrency(projectedPool)}/mo
            </span>
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

/* ── Edit Allocations tools header (growth + % allocator toggles) ── */

function EditTools({
  projectionYears,
  yearlyGrowth,
  setYearlyGrowth,
  basePool,
  goalProjections,
  onGoalUpdate,
}: {
  projectionYears: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
  basePool: number;
  goalProjections: GoalProjection[];
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
}) {
  const [showGrowth, setShowGrowth] = useState(false);
  const [showPctAllocator, setShowPctAllocator] = useState(false);
  const growthCount = Object.values(yearlyGrowth).filter(
    (e) => e.value !== 0,
  ).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setShowGrowth(!showGrowth);
            if (showPctAllocator) setShowPctAllocator(false);
          }}
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
          onClick={() => {
            setShowPctAllocator(!showPctAllocator);
            if (showGrowth) setShowGrowth(false);
          }}
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

      {showPctAllocator && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
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
            defaultPool={basePool}
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

/* ── Main AllocationEditorSection ── */

export interface AllocationEditorSectionProps {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  totalMonthlyAllocation: number;
  maxMonthlyFunding: number | null;
  monthlyPools: number[];
  canEdit: boolean;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti: (goalId: number, fields: Record<string, string>) => void;
  editingMonth: Date | null;
  setEditingMonth: (d: Date | null) => void;
  // Growth / allocator tools (moved from BudgetCapacityBar)
  projectionYears: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}

export function AllocationEditorSection({
  goalProjections,
  monthDates,
  totalMonthlyAllocation,
  maxMonthlyFunding,
  monthlyPools,
  canEdit,
  onGoalUpdate,
  onGoalUpdateMulti,
  editingMonth,
  setEditingMonth,
  projectionYears,
  yearlyGrowth,
  setYearlyGrowth,
}: AllocationEditorSectionProps) {
  const utils = trpc.useUtils();
  const basePool = maxMonthlyFunding ?? totalMonthlyAllocation;

  const upsertMonth = trpc.savings.allocationOverrides.upsertMonth.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const upsertMonthRange =
    trpc.savings.allocationOverrides.upsertMonthRange.useMutation({
      onSuccess: () => utils.savings.invalidate(),
    });
  const deleteMonthOverrides =
    trpc.savings.allocationOverrides.deleteMonth.useMutation({
      onSuccess: () => utils.savings.invalidate(),
    });

  return (
    <>
      {/* Growth + allocator tools */}
      <EditTools
        projectionYears={projectionYears}
        yearlyGrowth={yearlyGrowth}
        setYearlyGrowth={setYearlyGrowth}
        basePool={basePool}
        goalProjections={goalProjections}
        onGoalUpdate={onGoalUpdate}
      />

      {goalProjections.length > 0 && (
        <ContributionGrid
          goalProjections={goalProjections}
          monthDates={monthDates}
          totalMonthlyAllocation={totalMonthlyAllocation}
          maxMonthlyFunding={maxMonthlyFunding}
          monthlyPools={monthlyPools}
          onGoalUpdate={onGoalUpdate}
          onGoalUpdateMulti={onGoalUpdateMulti}
          onEditMonth={setEditingMonth}
          canEdit={canEdit}
        />
      )}

      {editingMonth && (
        <MonthOverrideModal
          key={`${editingMonth.getFullYear()}-${editingMonth.getMonth()}`}
          monthDate={editingMonth}
          monthDates={monthDates}
          goalProjections={goalProjections}
          pool={basePool}
          onUpsertMonth={(p) => upsertMonth.mutate(p)}
          onUpsertMonthRange={(p) => upsertMonthRange.mutate(p)}
          onDeleteMonthOverrides={(monthDates) => {
            deleteMonthOverrides.mutate({ monthDates });
          }}
          onClose={() => setEditingMonth(null)}
        />
      )}
    </>
  );
}
