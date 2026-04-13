"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { FUND_COLORS } from "./fund-colors";
import { GoalProjection, monthKey } from "./types";

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  amount: number;
  description: string;
  isRecurring: boolean;
  transferPairId?: string | null;
}

interface SavingsGoalSummary {
  goalId: number;
  name: string;
  current: number;
  target: number;
  monthlyAllocation: number;
  progress: number;
  monthsToTarget: number | null;
}

interface UpcomingItem {
  type: "expense" | "target_reached";
  fundName: string;
  fundColor: string;
  date: Date;
  monthsAway: number;
  amount: number;
  description: string;
  /** Balance at that point in time */
  projectedBalance: number;
  /** For expenses: will the fund cover it? */
  funded: boolean;
}

const MONTH_NAMES_SHORT = [
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

function formatMonthYear(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function monthsDiff(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

export function UpcomingGoals({
  goalProjections,
  savingsGoals,
  plannedTransactions,
  monthDates,
}: {
  goalProjections: GoalProjection[];
  savingsGoals: SavingsGoalSummary[];
  plannedTransactions: PlannedTransaction[];
  monthDates: Date[];
}) {
  const now = new Date();
  const items: UpcomingItem[] = [];

  for (let gpIdx = 0; gpIdx < goalProjections.length; gpIdx++) {
    const gp = goalProjections[gpIdx]!;
    const sg = savingsGoals.find((g) => g.goalId === gp.goalId);
    const color = FUND_COLORS[gpIdx % FUND_COLORS.length]!;

    // 1. Upcoming planned expenses (withdrawals)
    const fundTxs = plannedTransactions.filter(
      (t) => t.goalId === gp.goalId && t.amount < 0 && !t.transferPairId,
    );
    for (const tx of fundTxs) {
      const txDate = new Date(tx.transactionDate + "T00:00:00");
      if (txDate <= now) continue;
      const months = monthsDiff(now, txDate);
      // Find projected balance at that month
      const mi = monthDates.findIndex((d) => monthKey(d) === monthKey(txDate));
      const projBal = mi >= 0 ? gp.balances[mi]! : gp.current;
      items.push({
        type: "expense",
        fundName: gp.name,
        fundColor: color,
        date: txDate,
        monthsAway: months,
        amount: Math.abs(tx.amount),
        description: tx.description,
        projectedBalance: projBal,
        funded: projBal >= 0,
      });
    }

    // 2. Target reached milestone (for goals with a target and positive monthsToTarget)
    if (
      sg &&
      sg.target > 0 &&
      sg.monthsToTarget !== null &&
      sg.monthsToTarget > 0 &&
      sg.progress < 1
    ) {
      const targetDate = new Date(
        now.getFullYear(),
        now.getMonth() + sg.monthsToTarget,
        1,
      );
      items.push({
        type: "target_reached",
        fundName: gp.name,
        fundColor: color,
        date: targetDate,
        monthsAway: sg.monthsToTarget,
        amount: sg.target,
        description: "Target reached",
        projectedBalance: sg.target,
        funded: true,
      });
    }
  }

  const INITIAL_SHOW = 4;
  const [showAll, setShowAll] = useState(false);

  // Sort by date (soonest first)
  items.sort((a, b) => a.date.getTime() - b.date.getTime());

  if (items.length === 0) return null;
  const visibleItems = showAll ? items : items.slice(0, INITIAL_SHOW);
  const hasMore = items.length > INITIAL_SHOW;

  return (
    <div className="bg-surface-primary rounded-lg border p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-primary">
          Upcoming Milestones
        </h2>
        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {showAll ? "Show less" : `Show all (${items.length})`}
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {visibleItems.map((item) => (
          <div
            key={`${item.fundName}-${item.type}-${item.date.getTime()}`}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
              item.type === "expense"
                ? item.funded
                  ? "border bg-surface-sunken"
                  : "border-red-300/50 bg-red-50"
                : "border-green-300/30 bg-green-50"
            }`}
          >
            {/* Fund color dot */}
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: item.fundColor }}
            />

            {/* Icon — hidden on small screens to save space */}
            <div className="shrink-0 hidden sm:block">
              {item.type === "expense" ? (
                <svg
                  aria-hidden="true"
                  className={`w-5 h-5 ${item.funded ? "text-blue-600" : "text-red-600"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
                  />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-primary truncate">
                  {item.fundName}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    item.type === "expense"
                      ? item.funded
                        ? "bg-blue-100 text-blue-700"
                        : "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {item.type === "expense"
                    ? item.funded
                      ? "Funded"
                      : "Short"
                    : "Goal met"}
                </span>
              </div>
              <p className="text-xs text-muted truncate">{item.description}</p>
            </div>

            {/* Amount */}
            <div className="text-right shrink-0">
              <div
                className={`text-sm font-semibold tabular-nums ${
                  item.type === "expense" ? "text-primary" : "text-green-600"
                }`}
              >
                {item.type === "expense" ? "-" : ""}
                {formatCurrency(item.amount)}
              </div>
              {item.type === "expense" && (
                <div className="text-[10px] text-muted tabular-nums">
                  bal: {formatCurrency(item.projectedBalance)}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="text-right shrink-0 w-[4.5rem]">
              <div className="text-xs text-secondary font-medium">
                {formatMonthYear(item.date)}
              </div>
              <div className="text-[10px] text-muted">
                {item.monthsAway <= 0
                  ? "This month"
                  : item.monthsAway === 1
                    ? "1 month"
                    : `${item.monthsAway} months`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
