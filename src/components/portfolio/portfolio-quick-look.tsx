"use client";

/** Portfolio Quick Look stats panel — derives ATH, streaks, YTD/52w change,
 *  biggest/sharpest gains and losses, volatility, and all-time growth from
 *  the snapshot totals list. Toggles between dollar and percent presentation. */

import { useState, useMemo } from "react";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils/format";

export function PortfolioQuickLook({
  snapshots,
}: {
  snapshots: { id: number; date: string; total: number }[];
}) {
  const [mode, setMode] = useState<"dollar" | "percent">("dollar");
  const stats = useMemo(() => {
    if (snapshots.length < 2) return null;
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
    const current = sorted[sorted.length - 1]!;
    const first = sorted[0]!;

    // All-time high
    const ath = sorted.reduce((best, s) => (s.total > best.total ? s : best));
    const athDistance = current.total - ath.total;
    const athDistancePct = ath.total > 0 ? (athDistance / ath.total) * 100 : 0;

    // Changes between consecutive snapshots
    const changes = sorted.slice(1).map((s, i) => {
      const prev = sorted[i]!;
      const delta = s.total - prev.total;
      const days = Math.round(
        (new Date(s.date).getTime() - new Date(prev.date).getTime()) / 86400000,
      );
      const periodReturn = prev.total > 0 ? delta / prev.total : 0;
      const deltaPct = periodReturn * 100;
      return { date: s.date, delta, deltaPct, days };
    });

    // Biggest gain / loss — $ mode uses raw delta, % mode uses raw %
    const biggestGainDollar = changes.reduce((best, c) =>
      c.delta > best.delta ? c : best,
    );
    const biggestLossDollar = changes.reduce((worst, c) =>
      c.delta < worst.delta ? c : worst,
    );
    const biggestGainPct = changes.reduce((best, c) =>
      c.deltaPct > best.deltaPct ? c : best,
    );
    const biggestLossPct = changes.reduce((worst, c) =>
      c.deltaPct < worst.deltaPct ? c : worst,
    );

    // Sharpest gain / loss — ranked by rate of change ($/day or %/day)
    const withRate = changes.filter((c) => c.days > 0);
    const sharpestGainDollar = withRate.reduce((best, c) =>
      c.delta / c.days > best.delta / best.days ? c : best,
    );
    const sharpestLossDollar = withRate.reduce((worst, c) =>
      c.delta / c.days < worst.delta / worst.days ? c : worst,
    );
    const sharpestGainPct = withRate.reduce((best, c) =>
      c.deltaPct / c.days > best.deltaPct / best.days ? c : best,
    );
    const sharpestLossPct = withRate.reduce((worst, c) =>
      c.deltaPct / c.days < worst.deltaPct / worst.days ? c : worst,
    );

    // YTD change
    const currentYear = new Date().getFullYear().toString();
    const firstOfYear =
      sorted.find((s) => s.date >= `${currentYear}-01-01`) ?? first;
    const ytdDelta = current.total - firstOfYear.total;
    const ytdPct =
      firstOfYear.total > 0
        ? ((current.total - firstOfYear.total) / firstOfYear.total) * 100
        : 0;

    // 52-week change
    const oneYearAgoDate = new Date();
    oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgoDate.toISOString().slice(0, 10);
    const yearAgoSnap = sorted.reduce<(typeof sorted)[number] | null>(
      (best, s) => {
        if (s.date > oneYearAgoStr) return best;
        return !best ||
          Math.abs(
            new Date(s.date).getTime() - new Date(oneYearAgoStr).getTime(),
          ) <
            Math.abs(
              new Date(best.date).getTime() - new Date(oneYearAgoStr).getTime(),
            )
          ? s
          : best;
      },
      null,
    );
    const weekChange52 = yearAgoSnap ? current.total - yearAgoSnap.total : null;
    const weekChange52Pct =
      yearAgoSnap && yearAgoSnap.total > 0
        ? ((current.total - yearAgoSnap.total) / yearAgoSnap.total) * 100
        : null;

    // Streak
    let streak = 0;
    let streakDir: "gain" | "loss" | null = null;
    for (let i = changes.length - 1; i >= 0; i--) {
      const dir = changes[i]!.delta >= 0 ? "gain" : "loss";
      if (streakDir === null) streakDir = dir;
      if (dir === streakDir) streak++;
      else break;
    }

    // Average change per snapshot period
    const avgDelta =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.delta, 0) / changes.length
        : 0;
    const avgDeltaPct =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length
        : 0;
    const avgDays =
      changes.length > 0
        ? changes.reduce((s, c) => s + c.days, 0) / changes.length
        : 7;

    // Best/worst month — separate picks for $ vs %
    const byMonthDollar = new Map<string, number>();
    const byMonthPct = new Map<string, number>();
    for (const c of changes) {
      const month = c.date.slice(0, 7);
      byMonthDollar.set(month, (byMonthDollar.get(month) ?? 0) + c.delta);
      byMonthPct.set(month, (byMonthPct.get(month) ?? 0) + c.deltaPct);
    }
    const monthsDollar = [...byMonthDollar.entries()];
    const bestMonthDollar = monthsDollar.reduce(
      (best, [m, d]) => (d > best[1] ? [m, d] : best),
      monthsDollar[0] ?? ["", 0],
    );
    const worstMonthDollar = monthsDollar.reduce(
      (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
      monthsDollar[0] ?? ["", 0],
    );
    const monthsPctArr = [...byMonthPct.entries()];
    const bestMonthPct = monthsPctArr.reduce(
      (best, [m, d]) => (d > best[1] ? [m, d] : best),
      monthsPctArr[0] ?? ["", 0],
    );
    const worstMonthPct = monthsPctArr.reduce(
      (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
      monthsPctArr[0] ?? ["", 0],
    );

    // Volatility — stdev of per-period % changes
    const mean = changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length;
    const variance =
      changes.reduce((s, c) => s + (c.deltaPct - mean) ** 2, 0) /
      changes.length;
    const volatility = Math.sqrt(variance);

    // All-time growth vs first snapshot
    const allTimeGrowth = current.total - first.total;
    const allTimeGrowthPct =
      first.total > 0 ? ((current.total - first.total) / first.total) * 100 : 0;

    return {
      ath,
      athDistance,
      athDistancePct,
      isAtAth: Math.abs(athDistance) < 1,
      biggestGainDollar,
      biggestLossDollar,
      biggestGainPct,
      biggestLossPct,
      sharpestGainDollar,
      sharpestLossDollar,
      sharpestGainPct,
      sharpestLossPct,
      ytdDelta,
      ytdPct,
      weekChange52,
      weekChange52Pct,
      streak,
      streakDir,
      avgDelta,
      avgDeltaPct,
      bestMonthDollar,
      worstMonthDollar,
      bestMonthPct,
      worstMonthPct,
      volatility,
      avgDays,
      allTimeGrowth,
      allTimeGrowthPct,
      totalSnapshots: sorted.length,
      firstDate: first.date,
    };
  }, [snapshots]);

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
            </div>
            <div>
              <div className="text-xs text-muted">Sharpest Loss</div>
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
