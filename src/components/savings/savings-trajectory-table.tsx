"use client";

import React, { useMemo } from "react";
import { formatCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import { FUND_COLORS } from "@/lib/utils/colors";
import type { GoalProjection } from "./types";
import { trpc } from "@/lib/trpc";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { monthKey as monthKeyStr } from "@/lib/pure/date-keys";

function monthLabel(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} 1 '${String(d.getFullYear()).slice(2)}`;
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
  const [showAllocations, setShowAllocations] = useLocalStorage<boolean>(
    "ledgr:savings:showAllocations",
    false,
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
      <div className="text-label text-faint border-subtle bg-surface-sunken flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
        {hasAnyFixedTarget || hasAnyRevolving || hasAnyEvents ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {hasAnyFixedTarget && (
              <span className="flex items-center gap-1">
                <span className="font-bold text-green-500">✓</span>
                <span className="font-semibold text-green-600">$0,000</span>
                <span>= target reached</span>
              </span>
            )}
            {hasAnyRevolving && (
              <>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-green-600">$0,000</span>
                  <span>= withdrawal covered</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-amber-500">$0,000</span>
                  <span>= upcoming withdrawal won&apos;t be covered</span>
                </span>
              </>
            )}
            <span className="flex items-center gap-1">
              <span className="font-semibold text-red-500">-$0,000</span>
              <span>= balance negative</span>
            </span>
          </div>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="History range"
            value={String(historyWindow)}
            onChange={(e) => {
              const v = e.target.value;
              setHistoryWindow(
                v === "all" ? "all" : (Number(v) as HistoryWindow),
              );
            }}
            className="text-label border-surface-strong bg-surface-primary text-faint hover:text-primary rounded border px-1.5 py-0.5"
          >
            <option value="0">No history</option>
            <option value="3">3 months history</option>
            <option value="6">6 months history</option>
            <option value="12">1 year history</option>
            <option value="all">All history</option>
          </select>
          <button
            onClick={() => setShowAllocations(!showAllocations)}
            className="border-surface-strong text-faint hover:text-primary hover:border-primary text-label flex items-center gap-1 rounded border px-2 py-0.5 transition-colors"
          >
            <span>{showAllocations ? "▾" : "▸"}</span>
            <span>{showAllocations ? "Hide" : "Show"} allocations</span>
          </button>
          {hasAnyEvents && (
            <button
              onClick={() => setShowEvents(!showEvents)}
              className="border-surface-strong text-faint hover:text-primary hover:border-primary text-label flex items-center gap-1 rounded border px-2 py-0.5 transition-colors"
            >
              <span>{showEvents ? "▾" : "▸"}</span>
              <span>{showEvents ? "Hide" : "Show"} transactions</span>
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-lg border">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface-sunken border-b">
              <th className="bg-surface-sunken text-muted sticky top-0 left-0 z-20 w-48 border-r px-3 py-2 text-left text-xs font-medium whitespace-nowrap">
                Month
              </th>
              {visibleProjections.map((gp) => {
                const colorIdx = goalIdToColorIndex[gp.goalId] ?? 0;
                return (
                  <th
                    key={gp.goalId}
                    className="bg-surface-sunken sticky top-0 z-10 px-3 py-2 text-right align-top text-xs font-medium whitespace-nowrap"
                  >
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
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
                <th className="bg-surface-sunken text-faint/60 sticky top-0 z-10 px-3 py-2 text-right align-top text-xs font-medium whitespace-nowrap">
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
                  className="bg-surface-elevated/20 border-b"
                >
                  <td className="bg-surface-elevated/20 text-faint sticky left-0 z-10 border-r px-3 py-1.5 text-xs whitespace-nowrap">
                    {monthLabel(displayDate)}
                    <span className="text-micro text-faint/60 ml-1.5 tracking-wide uppercase">
                      actual
                    </span>
                  </td>
                  {visibleProjections.map((gp) => {
                    const val = balMap.get(gp.goalId);
                    return (
                      <td
                        key={gp.goalId}
                        className="text-muted px-3 py-1.5 text-right text-xs tabular-nums"
                      >
                        {val !== undefined ? formatCurrency(val) : "—"}
                      </td>
                    );
                  })}
                  {hiddenProjections.length > 0 && (
                    <td className="text-faint/50 px-3 py-1.5 text-right text-xs tabular-nums">
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
                  className="text-caption text-faint/50 bg-surface-sunken border-t border-b px-3 py-1 text-center tracking-widest"
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
                  {(() => {
                    const anyNegative = visibleProjections.some(
                      (gp) => (gp.balances[rowIdx] ?? 0) < 0,
                    );
                    return (
                      <tr
                        className={`hover:bg-surface-elevated/40 border-b transition-colors${anyNegative ? "bg-red-500/5" : ""}`}
                      >
                        <td className="bg-surface-primary text-muted sticky left-0 z-10 border-r px-3 py-1.5 text-xs whitespace-nowrap">
                          {monthLabel(date)}
                        </td>
                        {visibleProjections.map((gp) => {
                          const balance = gp.balances[rowIdx] ?? 0;
                          const isNegative = balance < 0;
                          const allocation = gp.monthlyAllocations[rowIdx] ?? 0;
                          const fundHasEvents =
                            (gp.monthEvents[rowIdx] ?? []).length > 0;
                          const showInlineAlloc =
                            showAllocations && !fundHasEvents && allocation > 0;
                          const inlineAlloc = showInlineAlloc ? (
                            <span className="text-micro ml-1 text-green-500/60 tabular-nums">
                              +{formatCurrency(allocation)}
                            </span>
                          ) : null;

                          // Fixed-target mode
                          if (gp.targetMode === "fixed" && gp.target > 0) {
                            const isFirstFunded =
                              firstFundedIndex[gp.goalId] === rowIdx;
                            const isFunded = balance >= gp.target;
                            let cls =
                              "text-right px-3 py-1.5 text-xs tabular-nums";
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
                                  <span className="text-caption mr-1 text-green-500">
                                    ✓
                                  </span>
                                )}
                                {formatCurrency(balance)}
                                {inlineAlloc}
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
                                  className="px-3 py-1.5 text-right text-xs text-red-500 tabular-nums"
                                >
                                  {formatCurrency(balance)}
                                  {inlineAlloc}
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
                                  className="px-3 py-1.5 text-right text-xs text-amber-500 tabular-nums"
                                >
                                  {formatCurrency(balance)}
                                  {inlineAlloc}
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
                                {formatCurrency(balance)}
                                {inlineAlloc}
                              </td>
                            );
                          }

                          // No target, no ongoing mode — neutral
                          return (
                            <td
                              key={gp.goalId}
                              className={`px-3 py-1.5 text-right text-xs tabular-nums ${
                                isNegative ? "text-red-500" : "text-primary"
                              }`}
                            >
                              {formatCurrency(balance)}
                              {inlineAlloc}
                            </td>
                          );
                        })}
                        {hiddenProjections.length > 0 && (
                          <td className="text-faint/50 bg-surface-sunken/40 px-3 py-1.5 text-right text-xs tabular-nums">
                            {formatCurrency(
                              hiddenProjections.reduce(
                                (s, gp) => s + (gp.balances[rowIdx] ?? 0),
                                0,
                              ),
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })()}

                  {/* Allocation sub-row — only when at least one visible fund has events this month */}
                  {showAllocations && rowEvents.length > 0 && (
                    <tr className="bg-surface-elevated/20 border-b">
                      <td
                        className="bg-surface-elevated/20 sticky left-0 z-10 border-r py-1"
                        style={{ borderLeft: "3px solid #22c55e66" }}
                      >
                        <span className="text-micro text-faint/50 pl-3">└</span>
                        <span className="text-micro pl-1 text-green-500/50">
                          contrib
                        </span>
                      </td>
                      {visibleProjections.map((gp) => {
                        const allocation = gp.monthlyAllocations[rowIdx] ?? 0;
                        const fundHasEvents =
                          (gp.monthEvents[rowIdx] ?? []).length > 0;
                        return (
                          <td key={gp.goalId} className="px-3 py-1 text-right">
                            {allocation > 0 && fundHasEvents && (
                              <span className="text-micro font-medium text-green-500/70 tabular-nums">
                                +{formatCurrency(allocation)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {hiddenProjections.length > 0 && <td />}
                    </tr>
                  )}

                  {/* Event sub-rows */}
                  {showEvents &&
                    rowEvents.map((ev) => {
                      return (
                        <tr
                          key={`ev-${ev.goalId}-${ev.id}`}
                          className="bg-surface-elevated/20 border-b last:border-0"
                        >
                          <td
                            className="bg-surface-elevated/20 sticky left-0 z-10 overflow-hidden border-r py-1"
                            style={{
                              borderLeft: "3px solid rgba(120,120,120,0.35)",
                            }}
                          >
                            <span className="text-micro text-faint/50 pl-3">
                              └
                            </span>
                            <span
                              className="text-micro text-faint/70 truncate pl-1"
                              title={ev.description}
                            >
                              {ev.description}
                            </span>
                          </td>
                          {visibleProjections.map((gp) => (
                            <td
                              key={gp.goalId}
                              className="px-3 py-1 text-right"
                            >
                              {gp.goalId === ev.goalId && (
                                <span
                                  className={`text-micro font-medium tabular-nums ${
                                    ev.amount < 0
                                      ? "text-red-500/70"
                                      : "text-green-500/70"
                                  }`}
                                >
                                  {ev.amount < 0 ? "−" : "+"}
                                  {formatCurrency(Math.abs(ev.amount))}
                                </span>
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
