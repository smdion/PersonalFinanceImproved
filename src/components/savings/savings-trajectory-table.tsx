"use client";

import React, { useState } from "react";
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
  return `${MONTH_NAMES[d.getMonth()]} 1 '${String(d.getFullYear()).slice(2)}`;
}

/**
 * For revolving funds (targetMode === "ongoing"), look ahead from month i
 * to find the next future withdrawal month. Returns the balance at that month,
 * or null if no future withdrawal exists.
 */
function nextWithdrawalBalance(
  gp: GoalProjection,
  fromIdx: number,
): number | null {
  for (let j = fromIdx; j < gp.balances.length; j++) {
    const hasWithdrawal = (gp.monthEvents[j] ?? []).some((ev) => ev.amount < 0);
    if (hasWithdrawal) return gp.balances[j]!;
  }
  return null;
}

export function SavingsTrajectoryTable({
  goalProjections,
  monthDates,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
}) {
  const [showEvents, setShowEvents] = useState(true);

  if (goalProjections.length === 0) return null;

  const hasAnyEvents = goalProjections.some((gp) =>
    gp.monthEvents.some((evs) => evs && evs.length > 0),
  );

  // Track the first month each fixed-target goal crosses its target
  const firstFundedIndex: Record<number, number> = {};
  for (const gp of goalProjections) {
    if (gp.targetMode !== "fixed" || gp.target <= 0) continue;
    const idx = gp.balances.findIndex((b) => b >= gp.target);
    if (idx !== -1) firstFundedIndex[gp.goalId] = idx;
  }

  const hasAnyFixedTarget = goalProjections.some(
    (gp) => gp.targetMode === "fixed" && gp.target > 0,
  );
  const hasAnyRevolving = goalProjections.some(
    (gp) => gp.targetMode === "ongoing",
  );

  return (
    <div className="space-y-2">
      {(hasAnyFixedTarget || hasAnyRevolving || hasAnyEvents) && (
        <div className="flex items-center justify-between gap-4 text-[11px] text-faint px-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {hasAnyFixedTarget && (
              <span className="flex items-center gap-1">
                <span className="text-green-500 font-bold">✓</span>
                <span className="text-green-600 font-semibold">$0,000</span>
                <span>= target reached</span>
              </span>
            )}
            {hasAnyRevolving && (
              <>
                <span className="flex items-center gap-1">
                  <span className="text-green-600 font-semibold">$0,000</span>
                  <span>= withdrawal covered</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-amber-500 font-semibold">$0,000</span>
                  <span>= upcoming withdrawal won&apos;t be covered</span>
                </span>
              </>
            )}
            <span className="flex items-center gap-1">
              <span className="text-red-500 font-semibold">-$0,000</span>
              <span>= balance negative</span>
            </span>
          </div>
          {hasAnyEvents && (
            <button
              onClick={() => setShowEvents((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-surface-strong text-faint hover:text-primary hover:border-primary transition-colors text-[11px] shrink-0"
            >
              <span>{showEvents ? "▾" : "▸"}</span>
              <span>{showEvents ? "Hide" : "Show"} transactions</span>
            </button>
          )}
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
                  {gp.targetMode === "fixed" && gp.target > 0 && (
                    <div className="text-[10px] text-faint font-normal">
                      target {formatCurrency(gp.target)}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthDates.map((date, rowIdx) => {
              // Collect all events this month across all funds, sorted
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
                      const isNegative = balance < 0;

                      // Fixed-target mode
                      if (gp.targetMode === "fixed" && gp.target > 0) {
                        const isFirstFunded =
                          firstFundedIndex[gp.goalId] === rowIdx;
                        const isFunded = balance >= gp.target;
                        let cls = "text-right px-3 py-1.5 text-xs tabular-nums";
                        if (isNegative) cls += " text-red-500";
                        else if (isFunded) cls += " text-green-600";
                        else cls += " text-primary";
                        const bg =
                          isFirstFunded && !isNegative
                            ? " bg-green-50/60 dark:bg-green-950/20"
                            : "";
                        return (
                          <td key={gp.goalId} className={cls + bg}>
                            {isFirstFunded && !isNegative && (
                              <span className="mr-1 text-green-500 text-[10px]">
                                ✓
                              </span>
                            )}
                            {formatCurrency(balance)}
                          </td>
                        );
                      }

                      // Revolving mode (ongoing, no fixed target)
                      if (gp.targetMode === "ongoing") {
                        const hasWithdrawalThisMonth = (
                          gp.monthEvents[rowIdx] ?? []
                        ).some((ev) => ev.amount < 0);

                        if (isNegative) {
                          return (
                            <td
                              key={gp.goalId}
                              className="text-right px-3 py-1.5 text-xs tabular-nums text-red-500"
                            >
                              {formatCurrency(balance)}
                            </td>
                          );
                        }

                        // Lookahead: find the next withdrawal balance from this month forward
                        const futureWithdrawalBal = nextWithdrawalBalance(
                          gp,
                          rowIdx,
                        );
                        const isAtRisk =
                          futureWithdrawalBal !== null &&
                          futureWithdrawalBal < 0;

                        if (isAtRisk) {
                          return (
                            <td
                              key={gp.goalId}
                              className="text-right px-3 py-1.5 text-xs tabular-nums text-amber-500"
                            >
                              {formatCurrency(balance)}
                            </td>
                          );
                        }

                        // Green only on months with a covered withdrawal; white otherwise
                        const cls =
                          "text-right px-3 py-1.5 text-xs tabular-nums" +
                          (hasWithdrawalThisMonth
                            ? " text-green-600"
                            : " text-primary");
                        return (
                          <td key={gp.goalId} className={cls}>
                            {formatCurrency(balance)}
                          </td>
                        );
                      }

                      // No target, no ongoing mode — neutral
                      return (
                        <td
                          key={gp.goalId}
                          className={`text-right px-3 py-1.5 text-xs tabular-nums ${
                            isNegative ? "text-red-500" : "text-primary"
                          }`}
                        >
                          {formatCurrency(balance)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Event sub-rows — visible when showEvents is true */}
                  {showEvents &&
                    rowEvents.map((ev) => {
                      const evColor =
                        FUND_COLORS[ev.gpIdx % FUND_COLORS.length]!;
                      return (
                        <tr
                          key={`ev-${ev.goalId}-${ev.id}`}
                          className="border-b last:border-0 bg-surface-elevated/20"
                        >
                          <td
                            className="sticky left-0 z-10 bg-surface-elevated/20 py-1 border-r"
                            style={{ borderLeft: `3px solid ${evColor}` }}
                          >
                            <span className="text-[9px] text-faint/50 pl-3">
                              └
                            </span>
                          </td>
                          {goalProjections.map((gp) => (
                            <td
                              key={gp.goalId}
                              className="text-right px-3 py-1"
                            >
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
