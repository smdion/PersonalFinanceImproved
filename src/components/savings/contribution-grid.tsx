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
  /** "YYYY-MM" keys for months that have rule-sourced extra-paycheck overrides. */
  ruleMonthKeys?: Set<string>;
  hiddenGoalIds?: Set<number>;
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
  return `${MONTH_NAMES[d.getMonth()]} 1 '${String(d.getFullYear()).slice(2)}`;
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

  const inputCls =
    "flex-1 text-left border border-default bg-surface-elevated text-primary rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  if (editing) {
    return (
      <>
        <div className="text-green-600/30 text-xs font-semibold tabular-nums text-center select-none">
          {formatCurrency(gp.monthlyAllocation)}
        </div>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-surface-primary border border-default rounded-xl shadow-2xl p-5 w-64 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-sm font-semibold text-primary">{gp.name}</p>
              <p className="text-caption text-faint mt-0.5">
                Default monthly contribution
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted w-4 shrink-0">$</span>
                <input
                  type="number"
                  autoFocus={editing === "dollar"}
                  value={dollarValue}
                  onChange={(e) => handleDollarChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className={inputCls}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0" />
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 border-t border-subtle/40" />
                  <span className="text-caption text-faint/60">or</span>
                  <div className="flex-1 border-t border-subtle/40" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted w-4 shrink-0">%</span>
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
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-default text-muted hover:text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // $0 and not funded → dash placeholder
  if (gp.monthlyAllocation === 0 && !isFunded) {
    return (
      <button
        onClick={canEdit !== false ? startEditDollar : undefined}
        className={`tabular-nums text-faint text-xs rounded transition-colors ${
          canEdit !== false
            ? "cursor-pointer hover:bg-surface-elevated/60 px-1"
            : ""
        }`}
        title="Click to set default monthly contribution"
      >
        —
      </button>
    );
  }

  // $0 but funded → funded badge only
  if (gp.monthlyAllocation === 0 && isFunded) {
    return (
      <button
        onClick={canEdit !== false ? startEditDollar : undefined}
        className={`text-caption text-green-600/70 rounded transition-colors ${
          canEdit !== false
            ? "cursor-pointer hover:bg-surface-elevated/60 px-1"
            : ""
        }`}
        title="Funded — click to set a contribution anyway"
      >
        ✓ funded
      </button>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
      <button
        onClick={canEdit !== false ? startEditDollar : undefined}
        className={`tabular-nums font-semibold text-green-600 text-xs rounded transition-colors ${
          canEdit !== false
            ? "cursor-pointer hover:bg-surface-elevated/60 px-1"
            : ""
        }`}
        title="Click to change default monthly contribution"
      >
        {formatCurrency(gp.monthlyAllocation)}
      </button>
      <button
        onClick={canEdit !== false ? startEditPercent : undefined}
        className={`tabular-nums text-caption text-muted rounded transition-colors ${
          canEdit !== false
            ? "cursor-pointer hover:bg-surface-elevated/60 px-1"
            : ""
        }`}
        title="Click to set by percentage of pool"
      >
        · {formatPercent(pct / 100)}
      </button>
      {isFunded && <span className="text-micro text-green-600/70">✓</span>}
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
  ruleMonthKeys,
  hiddenGoalIds,
}: ContributionGridProps) {
  // Base pool for the default row (no annual growth applied)
  const pool = maxMonthlyFunding ?? totalMonthlyAllocation;

  const visibleProjections = hiddenGoalIds
    ? goalProjections.filter((gp) => !hiddenGoalIds.has(gp.goalId))
    : goalProjections;
  const hiddenProjections = hiddenGoalIds
    ? goalProjections.filter((gp) => hiddenGoalIds.has(gp.goalId))
    : [];

  return (
    <div className="space-y-2">
      <div className="overflow-auto max-h-[480px] rounded-lg border">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            {/* Row 1: column headers — Month | fund names | hidden agg | Allocated */}
            <tr className="bg-surface-sunken border-b">
              <th className="sticky top-0 left-0 z-20 bg-surface-sunken text-left px-3 py-2 font-medium text-muted whitespace-nowrap border-r text-xs">
                Month
              </th>
              {visibleProjections.map((gp) => {
                const i = goalProjections.indexOf(gp);
                return (
                  <th
                    key={gp.goalId}
                    className="sticky top-0 z-10 bg-surface-sunken text-center px-2 py-2 font-medium text-xs whitespace-nowrap min-w-[110px]"
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
                );
              })}
              {hiddenProjections.length > 0 && (
                <th className="sticky top-0 z-10 bg-surface-sunken text-center px-2 py-2 font-medium text-caption text-faint/60 whitespace-nowrap min-w-[90px]">
                  {hiddenProjections.length} hidden
                </th>
              )}
              <th className="sticky top-0 z-10 bg-surface-sunken text-center px-2 py-2 font-medium text-caption text-muted whitespace-nowrap min-w-[80px]">
                Allocated
              </th>
            </tr>

            {/* Row 2: Default /mo — editable default contribution per fund */}
            <tr className="bg-surface-elevated border-b">
              <td className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-xs font-semibold text-green-500 border-r whitespace-nowrap">
                Default /mo
              </td>
              {visibleProjections.map((gp) => (
                <td
                  key={gp.goalId}
                  className="bg-surface-elevated text-center px-2 py-1.5"
                >
                  <DefaultContributionCell
                    gp={gp}
                    pool={pool}
                    onGoalUpdate={onGoalUpdate}
                    onGoalUpdateMulti={onGoalUpdateMulti}
                    canEdit={canEdit}
                  />
                </td>
              ))}
              {hiddenProjections.length > 0 && (
                <td className="text-center px-2 py-1.5 text-caption text-faint/50 tabular-nums bg-surface-sunken/40">
                  {formatCurrency(
                    hiddenProjections.reduce(
                      (s, gp) => s + gp.monthlyAllocation,
                      0,
                    ),
                  )}
                </td>
              )}
              <td className="bg-surface-elevated text-center px-2 py-1.5 text-caption text-muted tabular-nums">
                {formatCurrency(pool)}
              </td>
            </tr>
          </thead>

          <tbody>
            {monthDates.map((date, rowIdx) => {
              const mk = monthKey(date);
              const monthPool = monthlyPools[rowIdx]!;
              const monthTotal = visibleProjections.reduce(
                (s, gp) => s + (gp.monthlyAllocations[rowIdx] ?? 0),
                0,
              );
              const hiddenTotal = hiddenProjections.reduce(
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
                      className={`text-xs text-muted tabular-nums rounded transition-colors ${
                        canEdit !== false
                          ? "hover:bg-surface-elevated/60 cursor-pointer px-1 -mx-1"
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
                    {ruleMonthKeys?.has(mk) && (
                      <div className="text-micro text-purple-600 font-medium leading-tight mt-0.5">
                        ✦ extra check
                      </div>
                    )}
                  </td>

                  {/* Per-fund allocation cells */}
                  {visibleProjections.map((gp) => {
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
                          className={`tabular-nums text-label rounded transition-colors ${
                            canEdit !== false
                              ? "cursor-pointer hover:bg-surface-elevated/60 px-0.5"
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

                  {/* Hidden funds aggregate cell */}
                  {hiddenProjections.length > 0 && (
                    <td className="text-center py-1.5 px-2 bg-surface-sunken/40">
                      <span className="tabular-nums text-label text-faint/50">
                        {formatCurrency(hiddenTotal)}
                      </span>
                    </td>
                  )}

                  {/* Allocated column — total allocated this month, clickable to edit */}
                  <td className="text-center py-1.5 px-2">
                    <button
                      onClick={
                        canEdit !== false ? () => onEditMonth(date) : undefined
                      }
                      className={`tabular-nums text-caption rounded transition-colors ${
                        canEdit !== false
                          ? "cursor-pointer hover:bg-surface-elevated/60 px-0.5"
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
