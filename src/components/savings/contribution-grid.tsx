"use client";

import React, { useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { GoalProjection, monthKey } from "./types";
import { FUND_COLORS } from "./fund-colors";

interface ContributionGridProps {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  totalMonthlyAllocation: number;
  maxMonthlyFunding: number | null;
  monthlyPools: number[];
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti?: (goalId: number, fields: Record<string, string>) => void;
  onEditMonth: (monthDate: Date) => void;
  canEdit?: boolean;
}

const MONTH_NAMES = [
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

function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

/* ── Default contribution cell: $ and % that drive each other ── */

function DefaultContributionCell({
  gp,
  pool,
  onGoalUpdate,
  onGoalUpdateMulti,
  canEdit,
}: {
  gp: GoalProjection;
  pool: number;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti?: (goalId: number, fields: Record<string, string>) => void;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState<"dollar" | "percent" | null>(null);
  const [dollarValue, setDollarValue] = useState("");
  const [percentValue, setPercentValue] = useState("");

  const pct = pool > 0 ? (gp.monthlyAllocation / pool) * 100 : 0;

  // Already-funded funds show a special indicator instead of editable $0
  const isFunded = gp.target > 0 && gp.current >= gp.target;

  const startEditDollar = () => {
    setEditing("dollar");
    setDollarValue(String(Math.round(gp.monthlyAllocation)));
    setPercentValue(pct.toFixed(1));
  };

  const startEditPercent = () => {
    setEditing("percent");
    setPercentValue(pct.toFixed(1));
    setDollarValue(String(Math.round(gp.monthlyAllocation)));
  };

  const handleDollarChange = (val: string) => {
    setDollarValue(val);
    const num = parseFloat(val);
    if (!isNaN(num) && pool > 0) {
      setPercentValue(((num / pool) * 100).toFixed(1));
    }
  };

  const handlePercentChange = (val: string) => {
    setPercentValue(val);
    const num = parseFloat(val);
    if (!isNaN(num) && pool > 0) {
      setDollarValue(String(Math.round((num / 100) * pool)));
    }
  };

  const commit = () => {
    const dollar = dollarValue.replace(/[^0-9.]/g, "");
    const pctVal = parseFloat(percentValue);
    if (!dollar) {
      setEditing(null);
      return;
    }
    if (!isNaN(pctVal) && onGoalUpdateMulti) {
      onGoalUpdateMulti(gp.goalId, {
        monthlyContribution: dollar,
        allocationPercent: pctVal.toFixed(3),
      });
    } else {
      onGoalUpdate(gp.goalId, "monthlyContribution", dollar);
    }
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-muted">$</span>
          <input
            type="number"
            autoFocus={editing === "dollar"}
            value={dollarValue}
            onChange={(e) => handleDollarChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            className="w-14 text-center text-xs border border-green-500 bg-surface-primary text-primary rounded px-1 py-0.5 tabular-nums"
          />
        </div>
        <div className="flex items-center gap-0.5">
          <input
            type="number"
            autoFocus={editing === "percent"}
            value={percentValue}
            onChange={(e) => handlePercentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            step="0.1"
            className="w-14 text-center text-xs border border-green-500 bg-surface-primary text-primary rounded px-1 py-0.5 tabular-nums"
          />
          <span className="text-[9px] text-muted">%</span>
        </div>
        <button
          onClick={commit}
          className="px-2 py-0.5 text-[9px] bg-green-600 text-white rounded hover:bg-green-700"
        >
          Set
        </button>
      </div>
    );
  }

  if (isFunded) {
    return (
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-green-600 font-semibold">
          ✓ Funded
        </span>
        <span className="text-[9px] text-faint">$0/mo needed</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={canEdit !== false ? startEditDollar : undefined}
        className={`tabular-nums font-semibold text-green-600 text-xs ${
          canEdit !== false ? "cursor-pointer hover:text-green-700" : ""
        }`}
        title="Click to change default monthly contribution"
      >
        {formatCurrency(gp.monthlyAllocation)}
      </button>
      <button
        onClick={canEdit !== false ? startEditPercent : undefined}
        className={`tabular-nums text-[10px] text-muted ${
          canEdit !== false ? "cursor-pointer hover:text-secondary" : ""
        }`}
        title="Click to set by percentage of pool"
      >
        {formatPercent(pct / 100)}
      </button>
    </div>
  );
}

/* ── Main grid — months as rows (left), funds as columns (top) ── */

export function ContributionGrid({
  goalProjections,
  monthDates,
  totalMonthlyAllocation,
  maxMonthlyFunding,
  monthlyPools,
  onGoalUpdate,
  onGoalUpdateMulti,
  onEditMonth,
  canEdit,
}: ContributionGridProps) {
  // Base pool for the default row (no annual growth applied)
  const pool = maxMonthlyFunding ?? totalMonthlyAllocation;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-[11px] text-faint px-1">
        <span className="flex items-center gap-1">
          <span className="text-green-600 font-semibold">$0,000</span>
          <span>= default monthly contribution (click to edit)</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-blue-600 font-semibold">$0,000</span>
          <span>= month override (click month to change)</span>
        </span>
      </div>
      <div className="overflow-auto max-h-[480px] rounded-lg border">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Row 1: column headers — Month | fund names | Allocated */}
            <tr className="bg-surface-sunken border-b">
              <th className="sticky left-0 z-20 bg-surface-sunken text-left px-3 py-2 font-medium text-muted whitespace-nowrap border-r text-xs">
                Month
              </th>
              {goalProjections.map((gp, i) => (
                <th
                  key={gp.goalId}
                  className="text-center px-2 py-2 font-medium text-xs whitespace-nowrap min-w-[110px]"
                >
                  <span className="inline-flex items-center gap-1.5 justify-center">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: FUND_COLORS[i % FUND_COLORS.length],
                      }}
                    />
                    <span className="text-muted">{gp.name}</span>
                  </span>
                </th>
              ))}
              <th className="text-center px-2 py-2 font-medium text-[10px] text-muted whitespace-nowrap min-w-[80px]">
                Allocated
              </th>
            </tr>

            {/* Row 2: Default /mo — editable default contribution per fund */}
            <tr className="bg-surface-elevated border-b">
              <td className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-xs font-semibold text-green-500 border-r whitespace-nowrap">
                Default /mo
              </td>
              {goalProjections.map((gp) => (
                <td key={gp.goalId} className="text-center px-2 py-1.5">
                  <DefaultContributionCell
                    gp={gp}
                    pool={pool}
                    onGoalUpdate={onGoalUpdate}
                    onGoalUpdateMulti={onGoalUpdateMulti}
                    canEdit={canEdit}
                  />
                </td>
              ))}
              <td className="text-center px-2 py-1.5 text-[10px] text-muted tabular-nums">
                {formatCurrency(pool)}
              </td>
            </tr>
          </thead>

          <tbody>
            {monthDates.map((date, rowIdx) => {
              const mk = monthKey(date);
              const monthPool = monthlyPools[rowIdx]!;
              const monthTotal = goalProjections.reduce(
                (s, gp) => s + (gp.monthlyAllocations[rowIdx] ?? 0),
                0,
              );
              const isOverAllocated = Math.abs(monthTotal - monthPool) >= 1;
              const isYearStart = date.getMonth() === 0;

              return (
                <tr
                  key={mk}
                  className={`border-b last:border-0 hover:bg-surface-elevated/40 transition-colors ${
                    isYearStart ? "border-t-2 border-strong" : ""
                  }`}
                >
                  {/* Month label — click to open month override modal */}
                  <td className="sticky left-0 z-10 bg-surface-primary px-3 py-1.5 border-r whitespace-nowrap">
                    <button
                      onClick={
                        canEdit !== false ? () => onEditMonth(date) : undefined
                      }
                      className={`text-xs text-muted tabular-nums ${
                        canEdit !== false
                          ? "hover:text-blue-600 cursor-pointer"
                          : ""
                      }`}
                      title={
                        canEdit !== false
                          ? "Click to edit all fund allocations for this month"
                          : undefined
                      }
                    >
                      {monthLabel(date)}
                    </button>
                  </td>

                  {/* Per-fund allocation cells */}
                  {goalProjections.map((gp) => {
                    const allocation = gp.monthlyAllocations[rowIdx] ?? 0;
                    const isOverride = gp.hasOverride[rowIdx];
                    const balance = gp.balances[rowIdx] ?? 0;
                    const isNegative = balance < 0;

                    return (
                      <td
                        key={gp.goalId}
                        className={`text-center py-1.5 px-2 ${
                          isNegative ? "bg-red-50/30 dark:bg-red-950/10" : ""
                        }`}
                      >
                        <button
                          onClick={
                            canEdit !== false
                              ? () => onEditMonth(date)
                              : undefined
                          }
                          className={`tabular-nums text-[11px] ${
                            canEdit !== false
                              ? "cursor-pointer hover:text-blue-700"
                              : ""
                          } ${
                            isOverride
                              ? "text-blue-600 font-semibold"
                              : "text-faint"
                          }`}
                          title={`Balance: ${formatCurrency(balance)}${canEdit !== false ? " — Click to edit month" : ""}`}
                        >
                          {formatCurrency(allocation)}
                        </button>
                      </td>
                    );
                  })}

                  {/* Allocated column — total allocated this month, clickable to edit */}
                  <td className="text-center py-1.5 px-2">
                    <button
                      onClick={
                        canEdit !== false ? () => onEditMonth(date) : undefined
                      }
                      className={`tabular-nums text-[10px] ${
                        canEdit !== false
                          ? "cursor-pointer hover:text-blue-700"
                          : ""
                      } ${isOverAllocated ? "text-red-600 font-semibold" : "text-faint"}`}
                      title={
                        isOverAllocated
                          ? `Allocations don't match pool (${formatCurrency(monthTotal)} vs ${formatCurrency(monthPool)}) — Click to edit month`
                          : canEdit !== false
                            ? "Click to edit month"
                            : undefined
                      }
                    >
                      {formatCurrency(monthTotal)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
