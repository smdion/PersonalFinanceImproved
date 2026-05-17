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

function shortMonth(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return formatCurrency(n);
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted">Fund Tracker</span>
        <span className="text-[10px] text-faint">Toggle columns</span>
      </div>

      {/* Visible funds — full chips */}
      {visibleProjections.length > 0 && (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
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
                <span className="text-red-500 font-medium whitespace-nowrap">
                  ✗ Neg {shortMonth(monthDates[negIdx]!)}
                </span>
              );
            } else if (atRisk) {
              statusEl = (
                <span className="text-amber-500 font-medium whitespace-nowrap">
                  ⚠ At risk
                </span>
              );
            } else if (fundedIdx !== -1) {
              statusEl = (
                <span className="text-green-600 font-medium whitespace-nowrap">
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
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 px-3 py-1.5 rounded-lg border bg-surface-elevated/30 text-xs transition-colors cursor-pointer hover:bg-surface-elevated min-w-0"
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <span className="font-medium text-secondary truncate text-left">
                  {gp.name}
                </span>
                <span className="tabular-nums text-primary whitespace-nowrap">
                  {formatCompact(endBalance)}
                </span>
                {statusEl}
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
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-dashed border-strong text-[10px] text-faint hover:text-muted transition-colors cursor-pointer"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
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
