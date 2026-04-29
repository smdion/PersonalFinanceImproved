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
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
}) {
  if (goalProjections.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted">Fund Tracker</span>
        <span className="text-[10px] text-faint">
          — projected end balance &amp; status within this window
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {goalProjections.map((gp, i) => {
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
            <div
              key={gp.goalId}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-surface-elevated/30 text-xs"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              <span className="font-medium text-secondary whitespace-nowrap">
                {gp.name}
              </span>
              <span className="text-faint">·</span>
              <span className="tabular-nums text-primary whitespace-nowrap">
                {formatCompact(endBalance)}
              </span>
              <span className="text-faint">·</span>
              {statusEl}
            </div>
          );
        })}
      </div>
    </div>
  );
}
