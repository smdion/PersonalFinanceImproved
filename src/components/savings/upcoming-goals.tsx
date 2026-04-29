"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import { FUND_COLORS } from "./fund-colors";
import { GoalProjection, monthKey, PlannedTxForm } from "./types";

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  amount: number;
  description: string;
  isRecurring: boolean;
  recurrenceMonths: number | null;
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
  onUpdateTx: _onUpdateTx,
  updateTxPending: _updateTxPending,
}: {
  goalProjections: GoalProjection[];
  savingsGoals: SavingsGoalSummary[];
  plannedTransactions: PlannedTransaction[];
  monthDates: Date[];
  onUpdateTx?: (id: number, form: PlannedTxForm) => Promise<void> | void;
  updateTxPending?: boolean;
}) {
  const now = new Date();

  // Build one card per fund — only funds with an upcoming expense are shown
  const cards = goalProjections
    .map((gp, gpIdx) => {
      const sg = savingsGoals.find((g) => g.goalId === gp.goalId);
      const color = FUND_COLORS[gpIdx % FUND_COLORS.length]!;

      // Only consider withdrawals (expenses), skip deposits and transfers
      const nextExpense =
        plannedTransactions
          .filter(
            (t) => t.goalId === gp.goalId && t.amount < 0 && !t.transferPairId,
          )
          .map((tx) => {
            const txDate = new Date(tx.transactionDate + "T00:00:00");
            if (txDate <= now) return null;
            const mi = monthDates.findIndex(
              (d) => monthKey(d) === monthKey(txDate),
            );
            const projBal =
              mi >= 0 ? (gp.balances[mi] ?? gp.current) : gp.current;
            return {
              tx,
              date: txDate,
              monthsAway: monthsDiff(now, txDate),
              projBal,
              funded: projBal >= 0,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;

      if (!nextExpense) return null;

      const progress = sg ? Math.min(1, sg.progress) : null;
      const hasTarget = sg && sg.target > 0 && gp.targetMode === "fixed";

      return { gp, sg, color, nextExpense, progress, hasTarget };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // Sort by soonest upcoming expense first
    .sort(
      (a, b) => a.nextExpense.date.getTime() - b.nextExpense.date.getTime(),
    );

  if (cards.length === 0) return null;

  return (
    <div className="bg-surface-primary rounded-lg border p-3 sm:p-4">
      <h2 className="text-sm font-semibold text-primary mb-3">
        What You&apos;re Saving For
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {cards.map(({ gp, sg, color, nextExpense, progress, hasTarget }) => {
          const isShort = !nextExpense.funded;
          const monthsAway = nextExpense.monthsAway;

          return (
            <div
              key={gp.goalId}
              className={`rounded-lg border overflow-hidden ${
                isShort ? "border-red-400/40" : "border-surface-strong"
              }`}
            >
              {/* Colored top accent bar */}
              <div className="h-1 w-full" style={{ backgroundColor: color }} />

              <div className="px-3 py-2.5 space-y-2">
                {/* Fund name + balance */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-primary truncate">
                    {gp.name}
                  </span>
                  <span className="text-xs tabular-nums text-muted shrink-0">
                    {formatCurrency(gp.current)}
                    {hasTarget && sg && (
                      <span className="text-faint">
                        {" "}
                        / {formatCurrency(sg.target)}
                      </span>
                    )}
                  </span>
                </div>

                {/* Progress bar */}
                {hasTarget && progress !== null && (
                  <div className="h-1 rounded-full bg-surface-strong overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${progress * 100}%`,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                )}

                {/* Next expense — hero block */}
                <div
                  className={`rounded-md px-2.5 py-2 space-y-1 ${
                    isShort
                      ? "bg-red-500/8 border border-red-400/20"
                      : "bg-surface-elevated"
                  }`}
                >
                  {/* Description — hero text */}
                  <p className="text-sm font-semibold text-primary leading-tight truncate">
                    {nextExpense.tx.description}
                  </p>

                  {/* Countdown row */}
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] text-faint">
                        {formatMonthYear(nextExpense.date)}
                      </p>
                      <p
                        className={`text-[10px] font-medium ${
                          isShort ? "text-red-500" : "text-muted"
                        }`}
                      >
                        bal after: {formatCurrency(nextExpense.projBal)}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {/* Big countdown number */}
                      <div className="flex items-baseline gap-0.5 justify-end">
                        <span
                          className="text-2xl font-bold tabular-nums leading-none"
                          style={{ color }}
                        >
                          {monthsAway <= 0 ? "Now" : monthsAway}
                        </span>
                        {monthsAway > 0 && (
                          <span className="text-[10px] text-faint ml-0.5">
                            mo
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-xs font-semibold tabular-nums ${
                          isShort ? "text-red-500" : "text-primary"
                        }`}
                      >
                        −{formatCurrency(Math.abs(nextExpense.tx.amount))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
