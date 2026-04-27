"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import { FUND_COLORS } from "./fund-colors";
import type { GoalProjection } from "./types";

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

export function SavingsTrajectoryTable({
  goalProjections,
  monthDates,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
}) {
  if (goalProjections.length === 0) return null;

  // Track the first month each goal crosses its target (for ✓ indicator)
  const firstFundedIndex: Record<number, number> = {};
  for (const gp of goalProjections) {
    if (gp.target <= 0) continue;
    const idx = gp.balances.findIndex((b) => b >= gp.target);
    if (idx !== -1) firstFundedIndex[gp.goalId] = idx;
  }

  const hasAnyTarget = goalProjections.some((gp) => gp.target > 0);

  return (
    <div className="space-y-2">
      {hasAnyTarget && (
        <div className="flex items-center gap-4 text-[11px] text-faint px-1">
          <span className="flex items-center gap-1">
            <span className="text-green-500 font-bold">✓</span>
            <span className="text-green-600 font-semibold">$0,000</span>
            <span>= first month fund hits its target</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-red-500 font-semibold">-$0,000</span>
            <span>= balance goes negative (needs attention)</span>
          </span>
        </div>
      )}
      <div className="overflow-auto max-h-[480px] rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-sunken border-b">
              <th className="sticky left-0 z-20 bg-surface-sunken text-left px-3 py-2 font-medium text-muted text-xs whitespace-nowrap border-r">
                Month
              </th>
              {goalProjections.map((gp, i) => (
                <th
                  key={gp.goalId}
                  className="text-right px-3 py-2 font-medium text-xs whitespace-nowrap min-w-[110px]"
                >
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: FUND_COLORS[i % FUND_COLORS.length],
                      }}
                    />
                    <span className="text-muted">{gp.name}</span>
                  </span>
                  {gp.target > 0 && (
                    <div className="text-[10px] text-faint font-normal">
                      target {formatCurrency(gp.target)}
                    </div>
                  )}
                </th>
              ))}
            </tr>
            {/* "Now" row — current balances */}
            <tr className="bg-surface-elevated border-b">
              <td className="sticky left-0 z-10 bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-muted border-r whitespace-nowrap">
                Now
              </td>
              {goalProjections.map((gp) => (
                <td
                  key={gp.goalId}
                  className="text-right px-3 py-1.5 text-xs font-semibold tabular-nums"
                >
                  {formatCurrency(gp.current)}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthDates.map((date, rowIdx) => {
              // Collect all events this month across all funds, in order
              const rowEvents: {
                goalId: number;
                gpIdx: number;
                id: string;
                amount: number;
                description: string;
              }[] = [];
              for (let gi = 0; gi < goalProjections.length; gi++) {
                const gp = goalProjections[gi]!;
                for (const ev of gp.monthEvents[rowIdx] ?? []) {
                  rowEvents.push({
                    goalId: gp.goalId,
                    gpIdx: gi,
                    id: ev.id,
                    amount: ev.amount,
                    description: ev.description,
                  });
                }
              }
              // Sort: by gpIdx (fund order), then by description for determinism
              rowEvents.sort(
                (a, b) =>
                  a.gpIdx - b.gpIdx ||
                  a.description.localeCompare(b.description),
              );

              return (
                <React.Fragment key={date.toISOString()}>
                  {/* Main month row */}
                  <tr className="border-b hover:bg-surface-elevated/40 transition-colors">
                    <td className="sticky left-0 z-10 bg-surface-primary px-3 py-1.5 text-xs text-muted whitespace-nowrap border-r">
                      {monthLabel(date)}
                    </td>
                    {goalProjections.map((gp) => {
                      const balance = gp.balances[rowIdx] ?? 0;
                      const isFirstFunded =
                        firstFundedIndex[gp.goalId] === rowIdx;
                      const isFunded = gp.target > 0 && balance >= gp.target;
                      const isNegative = balance < 0;

                      let cellClass =
                        "text-right px-3 py-1.5 text-xs tabular-nums";
                      if (isNegative) {
                        cellClass += " text-red-500";
                      } else if (isFunded) {
                        cellClass += " text-green-600";
                      } else {
                        cellClass += " text-primary";
                      }

                      const rowBg =
                        isFirstFunded && !isNegative
                          ? " bg-green-50/60 dark:bg-green-950/20"
                          : "";

                      return (
                        <td key={gp.goalId} className={cellClass + rowBg}>
                          {isFirstFunded && !isNegative && (
                            <span className="mr-1 text-green-500 text-[10px]">
                              ✓
                            </span>
                          )}
                          {formatCurrency(balance)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Event sub-rows — one per transaction, always visible */}
                  {rowEvents.map((ev) => {
                    const evColor = FUND_COLORS[ev.gpIdx % FUND_COLORS.length]!;
                    return (
                      <tr
                        key={`ev-${ev.goalId}-${ev.id}`}
                        className="border-b last:border-0 bg-surface-elevated/20"
                      >
                        {/* Month column spacer — thin colored left accent */}
                        <td
                          className="sticky left-0 z-10 bg-surface-elevated/20 py-1 border-r"
                          style={{ borderLeft: `3px solid ${evColor}` }}
                        >
                          <span className="text-[9px] text-faint/50 pl-3">
                            └
                          </span>
                        </td>
                        {/* Per-fund columns */}
                        {goalProjections.map((gp) => (
                          <td key={gp.goalId} className="text-right px-3 py-1">
                            {gp.goalId === ev.goalId && (
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-[9px] text-faint truncate max-w-[80px] text-left">
                                  {ev.description}
                                </span>
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                                    ev.amount < 0
                                      ? "bg-red-500/10 text-red-500"
                                      : "bg-green-500/10 text-green-600"
                                  }`}
                                >
                                  {ev.amount < 0 ? "−" : "+"}
                                  {formatCurrency(Math.abs(ev.amount))}
                                </span>
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
