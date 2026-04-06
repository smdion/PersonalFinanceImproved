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
    // Save both $ (fallback) and % (source of truth) together
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

/* ── Main grid ── */

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
  const [isOpen, setIsOpen] = useState(true);

  // Base pool for the default column (no annual growth)
  const pool = maxMonthlyFunding ?? totalMonthlyAllocation;

  return (
    <div className="bg-surface-primary rounded-lg border p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2"
        >
          <svg
            className={`w-4 h-4 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
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
          <h2 className="text-sm font-semibold text-primary">
            Monthly Contributions
          </h2>
        </button>
        {isOpen && (
          <p className="text-[10px] text-muted">
            Set defaults (green). Click a month to edit all fund allocations.
            Blue = override.
          </p>
        )}
      </div>

      {isOpen && (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left py-1.5 pr-2 text-muted font-medium sticky left-0 bg-surface-primary z-20 min-w-[80px]">
                  Fund
                </th>
                <th className="text-center py-1.5 px-1.5 text-green-500 font-medium border-r-2 border-green-800/50">
                  <div className="text-[10px]">Default</div>
                  <div className="text-[8px] text-muted">/month</div>
                </th>
                {monthDates.map((d, monthIndex) => {
                  const mk = monthKey(d);
                  const isYearStart = d.getMonth() === 0;
                  const monthPool = monthlyPools[monthIndex]!;
                  const monthTotal = goalProjections.reduce(
                    (s, gp) => s + gp.monthlyAllocations[monthIndex]!,
                    0,
                  );
                  return (
                    <th
                      key={mk}
                      className={`text-center py-1 px-0.5 text-muted font-normal ${
                        isYearStart ? "border-l border-strong" : ""
                      }`}
                      title={`${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} — Total: ${formatCurrency(monthTotal)} (${monthPool > 0 ? formatPercent(monthTotal / monthPool) : "0%"} of pool ${formatCurrency(monthPool)})`}
                    >
                      <div className="text-[9px]">
                        {MONTH_NAMES[d.getMonth()]}
                      </div>
                      {isYearStart && (
                        <div className="text-[8px] text-muted">
                          {d.getFullYear()}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {goalProjections.map((gp, gpIndex) => (
                <tr key={gp.goalId} className="border-t border-subtle/50">
                  {/* Fund name */}
                  <td className="py-1.5 pr-2 sticky left-0 bg-surface-primary z-10">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            FUND_COLORS[gpIndex % FUND_COLORS.length],
                        }}
                      />
                      <span className="text-secondary font-medium truncate text-[11px]">
                        {gp.name}
                      </span>
                    </div>
                  </td>

                  {/* Default contribution: $ and % */}
                  <td className="py-1 px-2 text-center border-r-2 border-green-800/50">
                    <DefaultContributionCell
                      gp={gp}
                      pool={pool}
                      onGoalUpdate={onGoalUpdate}
                      onGoalUpdateMulti={onGoalUpdateMulti}
                      canEdit={canEdit}
                    />
                  </td>

                  {/* Month cells — read-only, click opens modal */}
                  {monthDates.map((d, monthIndex) => {
                    const mk = monthKey(d);
                    const allocation = gp.monthlyAllocations[monthIndex]!;
                    const isOverride = gp.hasOverride[monthIndex];
                    const balance = gp.balances[monthIndex]!;
                    const isNegative = balance < 0;
                    const isYearStart = d.getMonth() === 0;

                    return (
                      <td
                        key={mk}
                        className={`py-1 px-0.5 text-center ${
                          isYearStart ? "border-l border-strong" : ""
                        } ${isNegative ? "bg-red-50" : ""}`}
                      >
                        <button
                          onClick={
                            canEdit !== false ? () => onEditMonth(d) : undefined
                          }
                          className={`tabular-nums leading-tight text-[11px] ${
                            canEdit !== false
                              ? "cursor-pointer hover:text-blue-700"
                              : ""
                          } ${
                            isOverride
                              ? "text-blue-600 font-semibold"
                              : "text-faint"
                          }`}
                          title={`${formatPercent(monthlyPools[monthIndex]! > 0 ? allocation / monthlyPools[monthIndex]! : 0, 1)} of pool — Balance: ${formatCurrency(balance)}${canEdit !== false ? " — Click to edit month" : ""}`}
                        >
                          {Math.round(allocation).toLocaleString()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Pool allocation row — shows sum of allocations per month */}
              <tr className="border-t border-subtle/50">
                <td className="py-1 pr-3 sticky left-0 bg-surface-primary z-10">
                  <span className="text-muted font-medium text-[10px] uppercase tracking-wide">
                    Pool Alloc
                  </span>
                </td>
                <td className="py-1 px-2 text-center border-r-2 border-green-800/50">
                  <div className="text-[10px] tabular-nums text-muted">
                    {formatCurrency(pool)}
                  </div>
                </td>
                {monthDates.map((d, monthIndex) => {
                  const mk = monthKey(d);
                  const monthPool = monthlyPools[monthIndex]!;
                  const monthTotal = goalProjections.reduce(
                    (s, gp) => s + gp.monthlyAllocations[monthIndex]!,
                    0,
                  );
                  const isOverAllocated = Math.abs(monthTotal - monthPool) >= 1;
                  const isYearStart = d.getMonth() === 0;
                  return (
                    <td
                      key={mk}
                      className={`py-1 px-0.5 text-center text-[10px] tabular-nums ${
                        isYearStart ? "border-l border-strong" : ""
                      } ${isOverAllocated ? "text-red-600 font-semibold" : "text-faint"}`}
                      title={
                        isOverAllocated
                          ? `Allocations don't match pool (${formatCurrency(monthTotal)} vs ${formatCurrency(monthPool)})`
                          : undefined
                      }
                    >
                      {Math.round(monthTotal).toLocaleString()}
                    </td>
                  );
                })}
              </tr>

              {/* Totals row */}
              <tr className="border-t-2 border-strong">
                <td className="py-1.5 pr-3 sticky left-0 bg-surface-primary z-10">
                  <span className="text-muted font-medium text-[10px] uppercase tracking-wide">
                    Total Balance
                  </span>
                </td>
                <td className="py-1 px-2 text-center border-r-2 border-green-800/50">
                  <div className="text-xs tabular-nums font-semibold text-secondary">
                    {formatCurrency(totalMonthlyAllocation)}
                  </div>
                  <div className="text-[10px] text-muted">
                    {pool > 0
                      ? formatPercent(totalMonthlyAllocation / pool)
                      : "—"}
                  </div>
                </td>
                {monthDates.map((d, monthIndex) => {
                  const mk = monthKey(d);
                  const total = goalProjections.reduce(
                    (s, gp) => s + gp.balances[monthIndex]!,
                    0,
                  );
                  const isYearStart = d.getMonth() === 0;
                  return (
                    <td
                      key={mk}
                      className={`py-1 px-0.5 text-center text-[10px] tabular-nums ${
                        isYearStart ? "border-l border-strong" : ""
                      } ${total < 0 ? "text-red-600" : "text-muted"}`}
                    >
                      ${Math.round(total).toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
