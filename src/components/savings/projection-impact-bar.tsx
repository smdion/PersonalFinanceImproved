"use client";

import React from "react";
import { compactCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import { FUND_COLORS } from "@/lib/utils/colors";
import type { GoalProjection } from "./types";

function shortMonth(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

function isRevolvingAtRisk(gp: GoalProjection): boolean {
  for (let j = 0; j < gp.balances.length; j++) {
    const hasWithdrawal = (gp.monthEvents[j] ?? []).some((ev) => ev.amount < 0);
    if (hasWithdrawal && (gp.balances[j] ?? 0) < 0) return true;
  }
  return false;
}

export function ProjectionImpactBar({
  goalProjections,
  monthDates,
  hiddenGoalIds,
  onToggle,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  hiddenGoalIds: Set<number>;
  onToggle: (goalId: number) => void;
}) {
  if (goalProjections.length === 0) return null;

  const visibleProjections = goalProjections.filter(
    (gp) => !hiddenGoalIds.has(gp.goalId),
  );
  const hiddenProjections = goalProjections.filter((gp) =>
    hiddenGoalIds.has(gp.goalId),
  );

  return (
    <div className="border-subtle bg-surface-sunken space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted text-xs font-medium">Fund Tracker</span>
        <span className="text-caption text-faint">Toggle columns</span>
      </div>

      {/* Visible funds — full chips */}
      {visibleProjections.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {visibleProjections.map((gp) => {
            const i = goalProjections.indexOf(gp);
            const color = FUND_COLORS[i % FUND_COLORS.length]!;
            const endBalance = gp.balances[gp.balances.length - 1] ?? 0;

            const negIdx = gp.balances.findIndex((b) => b < 0);
            const fundedIdx =
              gp.targetMode === "fixed" && gp.target > 0
                ? gp.balances.findIndex((b) => b >= gp.target)
                : -1;
            const atRisk = gp.targetMode === "ongoing" && isRevolvingAtRisk(gp);

            let statusEl: React.ReactNode;
            if (negIdx !== -1) {
              statusEl = (
                <span className="font-medium whitespace-nowrap text-red-500">
                  ✗ Neg {shortMonth(monthDates[negIdx]!)}
                </span>
              );
            } else if (atRisk) {
              statusEl = (
                <span className="font-medium whitespace-nowrap text-amber-500">
                  ⚠ At risk
                </span>
              );
            } else if (fundedIdx !== -1) {
              statusEl = (
                <span className="font-medium whitespace-nowrap text-green-600">
                  ✓ {shortMonth(monthDates[fundedIdx]!)}
                </span>
              );
            } else {
              statusEl = (
                <span className="text-faint whitespace-nowrap">On track</span>
              );
            }

            return (
              <button
                key={gp.goalId}
                onClick={() => onToggle(gp.goalId)}
                aria-pressed={true}
                className="bg-surface-elevated/30 hover:bg-surface-elevated flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="text-secondary truncate font-medium">
                    {gp.name}
                  </span>
                  {statusEl}
                </span>
                <span className="text-caption flex items-center justify-between tabular-nums">
                  <span className="text-faint">
                    {compactCurrency(gp.current)}
                  </span>
                  <span className="text-primary flex items-center gap-1 font-medium">
                    <span className="text-faint">proj</span>
                    {compactCurrency(endBalance)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Hidden funds — compact pill strip */}
      {hiddenProjections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hiddenProjections.map((gp) => {
            const i = goalProjections.indexOf(gp);
            const color = FUND_COLORS[i % FUND_COLORS.length]!;
            return (
              <button
                key={gp.goalId}
                onClick={() => onToggle(gp.goalId)}
                aria-pressed={false}
                title={`Show ${gp.name}`}
                className="border-strong text-caption text-faint hover:text-muted inline-flex cursor-pointer items-center gap-1.5 rounded border border-dashed px-2 py-0.5 transition-colors"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color, opacity: 0.5 }}
                />
                <span className="line-through">{gp.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
