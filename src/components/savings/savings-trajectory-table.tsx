"use client";

import React, { useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { FUND_COLORS } from "./fund-colors";
import type { GoalProjection } from "./types";
import { trpc } from "@/lib/trpc";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";

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

function monthKeyStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

type HistoryWindow = 0 | 3 | 6 | 12 | "all";

export function SavingsTrajectoryTable({
  goalProjections,
  monthDates,
  hiddenGoalIds,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  hiddenGoalIds: Set<number>;
}) {
  const [showEvents, setShowEvents] = useLocalStorage<boolean>(
    "ledgr:savings:showEvents",
    true,
  );
  const [historyWindow, setHistoryWindow] = useLocalStorage<HistoryWindow>(
    "ledgr:savings:historyWindow",
    0,
  );

  // Lazy-load history only when enabled
  const { data: historyData } = trpc.savings.getMonthlyHistory.useQuery(
    undefined,
    { enabled: historyWindow !== 0 },
  );

  // Stable color map — must use full goalProjections so hidden funds keep their color
  const goalIdToColorIndex = useMemo(
    () => Object.fromEntries(goalProjections.map((gp, i) => [gp.goalId, i])),
    [goalProjections],
  );

  // Filter visible columns
  const visibleProjections = useMemo(
    () => goalProjections.filter((gp) => !hiddenGoalIds.has(gp.goalId)),
    [goalProjections, hiddenGoalIds],
  );
  const hiddenProjections = useMemo(
    () => goalProjections.filter((gp) => hiddenGoalIds.has(gp.goalId)),
    [goalProjections, hiddenGoalIds],
  );

  // ── Build historical rows (must be before early return — hook ordering) ──
  const firstProjectedKey = monthDates[0] ? monthKeyStr(monthDates[0]) : null;

  const historicalRows = useMemo(() => {
    if (
      historyWindow === 0 ||
      !historyData?.rows.length ||
      !firstProjectedKey
    ) {
      return [];
    }

    // Group by monthDate
    const byMonth = new Map<string, Map<number, number>>();
    for (const row of historyData.rows) {
      // Normalize to YYYY-MM-01
      const key = row.monthDate.slice(0, 7) + "-01";
      if (key >= firstProjectedKey) continue; // only past months
      if (!byMonth.has(key)) byMonth.set(key, new Map());
      byMonth.get(key)!.set(row.goalId, row.balance);
    }

    // Sort ascending, then slice to window
    const sorted = Array.from(byMonth.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const windowed =
      historyWindow === "all" ? sorted : sorted.slice(-historyWindow);

    return windowed.map(([key, balMap]) => ({ key, balMap }));
  }, [historyData, historyWindow, firstProjectedKey]);

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
      <div className="flex items-center justify-between gap-4 text-label text-faint border border-subtle rounded-lg px-3 py-2 bg-surface-sunken">
        {hasAnyFixedTarget || hasAnyRevolving || hasAnyEvents ? (
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
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 shrink-0">
          <select
            aria-label="History range"
            value={String(historyWindow)}
            onChange={(e) => {
              const v = e.target.value;
              setHistoryWindow(
                v === "all" ? "all" : (Number(v) as HistoryWindow),
              );
            }}
            className="text-label border border-surface-strong rounded px-1.5 py-0.5 bg-surface-primary text-faint hover:text-primary"
          >
            <option value="0">No history</option>
            <option value="3">3 months history</option>
            <option value="6">6 months history</option>
            <option value="12">1 year history</option>
            <option value="all">All history</option>
          </select>
          {hasAnyEvents && (
            <button
              onClick={() => setShowEvents(!showEvents)}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-surface-strong text-faint hover:text-primary hover:border-primary transition-colors text-label"
            >
              <span>{showEvents ? "▾" : "▸"}</span>
              <span>{showEvents ? "Hide" : "Show"} transactions</span>
            </button>
          )}
        </div>
      </div>
      <div className="overflow-auto max-h-[480px] rounded-lg border">
        <table className="table-fixed w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-surface-sunken border-b">
              <th className="sticky top-0 left-0 z-20 w-28 bg-surface-sunken text-left px-3 py-2 font-medium text-muted text-xs whitespace-nowrap border-r">
                Month
              </th>
              {visibleProjections.map((gp) => {
                const colorIdx = goalIdToColorIndex[gp.goalId] ?? 0;
                return (
                  <th
                    key={gp.goalId}
                    className="sticky top-0 z-10 bg-surface-sunken text-right px-3 py-2 font-medium text-xs whitespace-nowrap align-top"
                  >
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            FUND_COLORS[colorIdx % FUND_COLORS.length],
                        }}
                      />
                      <span className="text-muted">{gp.name}</span>
                    </span>
                    {gp.targetMode === "fixed" && gp.target > 0 ? (
                      <div className="text-caption text-faint font-normal">
                        target {formatCurrency(gp.target)}
                      </div>
                    ) : gp.targetMode === "ongoing" ? (
                      <div className="text-caption text-faint/60 font-normal italic">
                        revolving
                      </div>
                    ) : (
                      <div className="text-caption text-faint/40 font-normal">
                        no target
                      </div>
                    )}
                  </th>
                );
              })}
              {hiddenProjections.length > 0 && (
                <th className="sticky top-0 z-10 bg-surface-sunken text-right px-3 py-2 font-medium text-xs whitespace-nowrap align-top text-faint/60">
                  {hiddenProjections.length} hidden
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {/* ── Historical rows ── */}
            {historicalRows.map(({ key, balMap }) => {
              // Parse key back to a display label
              const [yr, mo] = key.split("-");
              const displayDate = new Date(Number(yr), Number(mo) - 1, 1);
              return (
                <tr
                  key={`hist-${key}`}
                  className="border-b bg-surface-elevated/20"
                >
                  <td className="sticky left-0 z-10 bg-surface-elevated/20 px-3 py-1.5 text-xs text-faint whitespace-nowrap border-r">
                    {monthLabel(displayDate)}
                    <span className="ml-1.5 text-micro text-faint/60 uppercase tracking-wide">
                      actual
                    </span>
                  </td>
                  {visibleProjections.map((gp) => {
                    const val = balMap.get(gp.goalId);
                    return (
                      <td
                        key={gp.goalId}
                        className="text-right px-3 py-1.5 text-xs tabular-nums text-muted"
                      >
                        {val !== undefined ? formatCurrency(val) : "—"}
                      </td>
                    );
                  })}
                  {hiddenProjections.length > 0 && (
                    <td className="text-right px-3 py-1.5 text-xs tabular-nums text-faint/50">
                      {formatCurrency(
                        hiddenProjections.reduce(
                          (s, gp) => s + (balMap.get(gp.goalId) ?? 0),
                          0,
                        ),
                      )}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* ── Separator between history and projections ── */}
            {historicalRows.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleProjections.length + 1}
                  className="px-3 py-1 text-caption text-faint/50 text-center bg-surface-sunken border-b border-t tracking-widest"
                >
                  ─── Projected ───
                </td>
              </tr>
            )}

            {/* ── Projected rows ── */}
            {monthDates.map((date, rowIdx) => {
              // Collect events across visible funds only
              const rowEvents: {
                goalId: number;
                id: string;
                amount: number;
                description: string;
                colorIdx: number;
              }[] = [];
              for (const gp of visibleProjections) {
                for (const ev of gp.monthEvents[rowIdx] ?? []) {
                  rowEvents.push({
                    goalId: gp.goalId,
                    id: ev.id,
                    amount: ev.amount,
                    description: ev.description,
                    colorIdx: goalIdToColorIndex[gp.goalId] ?? 0,
                  });
                }
              }
              rowEvents.sort(
                (a, b) =>
                  a.colorIdx - b.colorIdx ||
                  a.description.localeCompare(b.description),
              );

              return (
                <React.Fragment key={date.toISOString()}>
                  {/* Main month row */}
                  <tr className="border-b hover:bg-surface-elevated/40 transition-colors">
                    <td className="sticky left-0 z-10 bg-surface-primary px-3 py-1.5 text-xs text-muted whitespace-nowrap border-r">
                      {monthLabel(date)}
                    </td>
                    {visibleProjections.map((gp) => {
                      const balance = gp.balances[rowIdx] ?? 0;
                      const isNegative = balance < 0;
                      const prevBalance =
                        rowIdx === 0
                          ? gp.current
                          : (gp.balances[rowIdx - 1] ?? 0);
                      const netChange = balance - prevBalance;
                      const deltaEl = (
                        <div
                          className={`text-micro tabular-nums mt-0.5 ${
                            netChange >= 0
                              ? "text-green-500/60"
                              : "text-red-400/70"
                          }`}
                        >
                          {netChange >= 0 ? "▲" : "▼"}{" "}
                          {netChange >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(netChange))}
                        </div>
                      );

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
                            <div>
                              {isFirstFunded && !isNegative && (
                                <span className="mr-1 text-green-500 text-caption">
                                  ✓
                                </span>
                              )}
                              {formatCurrency(balance)}
                            </div>
                            {deltaEl}
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
                              <div>{formatCurrency(balance)}</div>
                              {deltaEl}
                            </td>
                          );
                        }

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
                              <div>{formatCurrency(balance)}</div>
                              {deltaEl}
                            </td>
                          );
                        }

                        const cls =
                          "text-right px-3 py-1.5 text-xs tabular-nums" +
                          (hasWithdrawalThisMonth
                            ? " text-green-600"
                            : " text-primary");
                        return (
                          <td key={gp.goalId} className={cls}>
                            <div>{formatCurrency(balance)}</div>
                            {deltaEl}
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
                          <div>{formatCurrency(balance)}</div>
                          {deltaEl}
                        </td>
                      );
                    })}
                    {hiddenProjections.length > 0 && (
                      <td className="text-right px-3 py-1.5 text-xs tabular-nums text-faint/50 bg-surface-sunken/40">
                        {formatCurrency(
                          hiddenProjections.reduce(
                            (s, gp) => s + (gp.balances[rowIdx] ?? 0),
                            0,
                          ),
                        )}
                      </td>
                    )}
                  </tr>

                  {/* Event sub-rows */}
                  {showEvents &&
                    rowEvents.map((ev) => {
                      const evColor =
                        FUND_COLORS[ev.colorIdx % FUND_COLORS.length]!;
                      return (
                        <tr
                          key={`ev-${ev.goalId}-${ev.id}`}
                          className="border-b last:border-0 bg-surface-elevated/20"
                        >
                          <td
                            className="sticky left-0 z-10 bg-surface-elevated/20 py-1 border-r"
                            style={{ borderLeft: `3px solid ${evColor}` }}
                          >
                            <span className="text-micro text-faint/50 pl-3">
                              └
                            </span>
                          </td>
                          {visibleProjections.map((gp) => (
                            <td
                              key={gp.goalId}
                              className="text-right px-3 py-1"
                            >
                              {gp.goalId === ev.goalId && (
                                <div className="flex items-center justify-end gap-1 mr-3">
                                  <span className="text-faint/30 text-micro select-none">
                                    └
                                  </span>
                                  <span className="text-micro text-faint truncate max-w-[80px] text-left">
                                    {ev.description}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-caption font-semibold tabular-nums ${
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
                          {hiddenProjections.length > 0 && (
                            <td className="bg-surface-sunken/40" />
                          )}
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
