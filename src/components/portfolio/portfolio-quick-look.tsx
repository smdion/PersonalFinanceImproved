"use client";

/** Portfolio Quick Look stats panel — derives ATH, streaks, YTD/52w change,
 *  biggest/sharpest gains and losses, volatility, and all-time growth from
 *  the snapshot totals list. Toggles between dollar and percent presentation. */

import { useState, useMemo } from "react";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils/format";
import { derivePortfolioQuickLookStats } from "./portfolio-quick-look-stats";

export function PortfolioQuickLook({
  snapshots,
}: {
  snapshots: { id: number; date: string; total: number }[];
}) {
  const [mode, setMode] = useState<"dollar" | "percent">("dollar");
  const stats = useMemo(
    () => derivePortfolioQuickLookStats(snapshots),
    [snapshots],
  );

  if (!stats) return null;

  const isDollar = mode === "dollar";
  const clr = (v: number) => (v >= 0 ? "text-green-500" : "text-red-500");
  const sign = (v: number) => (v >= 0 ? "+" : "");
  const fmtPrimary = (dollars: number, percent: number) =>
    isDollar
      ? `${sign(dollars)}${formatCurrency(dollars)}`
      : `${sign(percent)}${formatPercent(percent / 100, 2)}`;
  const fmtSecondary = (dollars: number, percent: number) =>
    isDollar
      ? `${sign(percent)}${formatPercent(percent / 100, 1)}`
      : `${sign(dollars)}${formatCurrency(dollars)}`;
  const biggestGain = isDollar ? stats.biggestGainDollar : stats.biggestGainPct;
  const biggestLoss = isDollar ? stats.biggestLossDollar : stats.biggestLossPct;
  const sharpestGain = isDollar
    ? stats.sharpestGainDollar
    : stats.sharpestGainPct;
  const sharpestLoss = isDollar
    ? stats.sharpestLossDollar
    : stats.sharpestLossPct;
  const bestMonth = isDollar ? stats.bestMonthDollar : stats.bestMonthPct;
  const worstMonth = isDollar ? stats.worstMonthDollar : stats.worstMonthPct;
  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split("-");
    const months = [
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
    return `${months[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="mb-4 bg-surface-primary border rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-primary">
          Portfolio Quick Look
        </h3>
        <div className="inline-flex rounded-md border border-strong text-xs">
          <button
            type="button"
            onClick={() => setMode("dollar")}
            className={`px-2.5 py-1 rounded-l-md transition-colors ${isDollar ? "bg-indigo-600 text-white" : "text-muted hover:text-primary"}`}
          >
            $
          </button>
          <button
            type="button"
            onClick={() => setMode("percent")}
            className={`px-2.5 py-1 rounded-r-md transition-colors ${!isDollar ? "bg-indigo-600 text-white" : "text-muted hover:text-primary"}`}
          >
            %
          </button>
        </div>
      </div>
      <div className="space-y-4 text-sm">
        {/* Section: Performance */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Performance
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">All-Time High</div>
              <div className="font-medium">
                {formatCurrency(stats.ath.total)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(stats.ath.date, "medium")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">vs. Peak</div>
              <div
                className={`font-medium ${stats.isAtAth ? "text-green-500" : "text-red-500"}`}
              >
                {stats.isAtAth
                  ? "At all-time high"
                  : fmtPrimary(stats.athDistance, stats.athDistancePct)}
              </div>
              {!stats.isAtAth && (
                <div className="text-xs text-faint">
                  {fmtSecondary(stats.athDistance, stats.athDistancePct)}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted">YTD Change</div>
              <div className={`font-medium ${clr(stats.ytdDelta)}`}>
                {fmtPrimary(stats.ytdDelta, stats.ytdPct)}
              </div>
              <div className="text-xs text-faint">
                {fmtSecondary(stats.ytdDelta, stats.ytdPct)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">52-Week Change</div>
              {stats.weekChange52 != null ? (
                <>
                  <div className={`font-medium ${clr(stats.weekChange52)}`}>
                    {fmtPrimary(stats.weekChange52, stats.weekChange52Pct!)}
                  </div>
                  <div className="text-xs text-faint">
                    {fmtSecondary(stats.weekChange52, stats.weekChange52Pct!)}
                  </div>
                </>
              ) : (
                <div className="text-faint">Not enough data</div>
              )}
            </div>
          </div>
        </div>

        {/* Section: Extremes */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Extremes
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Biggest Gain</div>
              <div className="font-medium text-green-500">
                {fmtPrimary(biggestGain.delta, biggestGain.deltaPct)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(biggestGain.date, "medium")} ·{" "}
                {fmtSecondary(biggestGain.delta, biggestGain.deltaPct)} over{" "}
                {biggestGain.days}d
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Biggest Loss</div>
              <div className="font-medium text-red-500">
                {fmtPrimary(biggestLoss.delta, biggestLoss.deltaPct)}
              </div>
              <div className="text-xs text-faint">
                {formatDate(biggestLoss.date, "medium")} ·{" "}
                {fmtSecondary(biggestLoss.delta, biggestLoss.deltaPct)} over{" "}
                {biggestLoss.days}d
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Sharpest Gain</div>
              {sharpestGain ? (
                <>
                  <div className="font-medium text-green-500">
                    {isDollar
                      ? `+${formatCurrency(sharpestGain.delta / sharpestGain.days)}/day`
                      : `+${formatPercent(sharpestGain.deltaPct / sharpestGain.days / 100, 2)}/day`}
                  </div>
                  <div className="text-xs text-faint">
                    {formatDate(sharpestGain.date, "medium")} ·{" "}
                    {fmtPrimary(sharpestGain.delta, sharpestGain.deltaPct)} over{" "}
                    {sharpestGain.days}d
                  </div>
                </>
              ) : (
                <div className="text-faint">Not enough data</div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted">Sharpest Loss</div>
              {sharpestLoss ? (
                <>
                  <div className="font-medium text-red-500">
                    {isDollar
                      ? `${formatCurrency(sharpestLoss.delta / sharpestLoss.days)}/day`
                      : `${formatPercent(sharpestLoss.deltaPct / sharpestLoss.days / 100, 2)}/day`}
                  </div>
                  <div className="text-xs text-faint">
                    {formatDate(sharpestLoss.date, "medium")} ·{" "}
                    {fmtPrimary(sharpestLoss.delta, sharpestLoss.deltaPct)} over{" "}
                    {sharpestLoss.days}d
                  </div>
                </>
              ) : (
                <div className="text-faint">Not enough data</div>
              )}
            </div>
          </div>
        </div>

        {/* Section: Trends */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Trends
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Current Streak</div>
              <div
                className={`font-medium ${stats.streakDir === "gain" ? "text-green-500" : "text-red-500"}`}
              >
                {stats.streak}{" "}
                {stats.streakDir === "gain"
                  ? `consecutive gain${stats.streak !== 1 ? "s" : ""}`
                  : `consecutive loss${stats.streak !== 1 ? "es" : ""}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Avg Change</div>
              <div className={`font-medium ${clr(stats.avgDelta)}`}>
                {fmtPrimary(stats.avgDelta, stats.avgDeltaPct)}
              </div>
              <div className="text-xs text-faint">
                {fmtSecondary(stats.avgDelta, stats.avgDeltaPct)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Best Month</div>
              <div className="font-medium text-green-500">
                {isDollar
                  ? `+${formatCurrency(bestMonth[1] as number)}`
                  : `+${formatPercent((bestMonth[1] as number) / 100, 2)}`}
              </div>
              <div className="text-xs text-faint">
                {fmtMonth(bestMonth[0] as string)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Worst Month</div>
              <div className="font-medium text-red-500">
                {isDollar
                  ? formatCurrency(worstMonth[1] as number)
                  : formatPercent((worstMonth[1] as number) / 100, 2)}
              </div>
              <div className="text-xs text-faint">
                {fmtMonth(worstMonth[0] as string)}
              </div>
            </div>
          </div>
        </div>

        {/* Section: Risk & Growth */}
        <div>
          <div className="text-[10px] text-faint uppercase tracking-wider font-semibold mb-2 border-b border-subtle pb-1">
            Risk & Growth
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-muted">Volatility</div>
              <div className="font-medium">
                {formatPercent(stats.volatility / 100, 2)} per snapshot
              </div>
              <div className="text-xs text-faint">
                Std dev of % changes (~{Math.round(stats.avgDays)}d avg gap)
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">All-Time Growth</div>
              <div className={`font-medium ${clr(stats.allTimeGrowth)}`}>
                {fmtPrimary(stats.allTimeGrowth, stats.allTimeGrowthPct)}
              </div>
              <div className="text-xs text-faint">
                Since {formatDate(stats.firstDate, "medium")} (
                {stats.totalSnapshots} snapshots)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
