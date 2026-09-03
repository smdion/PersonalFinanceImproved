"use client";

/** Time-frame-selectable area chart that visualizes portfolio total value over time from snapshot data, with hover tooltips showing period-over-period change. */

import { useState, useMemo, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  formatPercent,
  compactCurrency,
} from "@/lib/utils/format";
import { CHART_COLORS, chartLinePalette } from "@/lib/utils/colors";
import { useTheme } from "@/lib/hooks/use-theme";
import { safeDivide } from "@/lib/utils/math";
import { CHART_FONT } from "@/components/charts/chart-defaults";

type TimeFrame = "YTD" | "3M" | "6M" | "1Y" | "3Y" | "All";
const TIME_FRAMES: TimeFrame[] = ["YTD", "3M", "6M", "1Y", "3Y", "All"];

type SnapshotPoint = { date: string; total: number };

type ChartPoint = {
  date: string;
  label: string;
  total: number;
  change: number | null;
  changePct: number | null;
};

function getTimeFrameCutoff(tf: TimeFrame): string | null {
  if (tf === "All") return null;
  if (tf === "YTD") {
    return `${new Date().getFullYear()}-01-01`;
  }
  const months = { "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[tf];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff.toISOString().slice(0, 10);
}

export function PortfolioChart({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const c = {
    ...CHART_COLORS,
    ...chartLinePalette(useTheme().resolvedTheme === "dark"),
  };
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1Y");
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);

  const chartData = useMemo(() => {
    if (snapshots.length === 0) return [];

    const cutoffStr = getTimeFrameCutoff(timeFrame);
    let filtered = snapshots;
    if (cutoffStr !== null) {
      filtered = snapshots.filter((s) => s.date >= cutoffStr);
    }

    return filtered.map((s, i) => {
      const prev = i > 0 ? filtered[i - 1] : null;
      const change = prev ? s.total - prev.total : null;
      const changeRatio = prev ? safeDivide(change!, prev.total, null) : null;
      const changePct = changeRatio === null ? null : changeRatio * 100;
      const d = new Date(s.date + "T00:00:00");
      return {
        date: s.date,
        label: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "2-digit",
        }),
        total: s.total,
        change,
        changePct,
      } satisfies ChartPoint;
    });
  }, [snapshots, timeFrame]);

  if (chartData.length === 0) {
    return (
      <Card title="Portfolio Value">
        <p className="text-faint text-sm">
          No snapshot data for the selected time frame.
        </p>
      </Card>
    );
  }

  const first = chartData[0]!;
  const last = chartData[chartData.length - 1]!;
  const totalChange = last.total - first.total;
  const totalChangePct = safeDivide(totalChange, first.total, 0) * 100;
  const isPositive = totalChange >= 0;

  return (
    <Card
      title="Portfolio Value"
      headerRight={
        <div className="flex items-center gap-3">
          <span
            className={`text-sm font-medium ${isPositive ? "text-green-600" : "text-red-600"}`}
          >
            {isPositive ? "+" : ""}
            {formatCurrency(totalChange)}
            <span className="ml-1 text-xs">
              ({isPositive ? "+" : ""}
              {formatPercent(totalChangePct / 100, 1)})
            </span>
          </span>
          <div className="bg-surface-elevated flex gap-0.5 rounded-md p-0.5">
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeFrame(tf)}
                className={`text-label rounded px-2 py-0.5 transition-colors ${
                  timeFrame === tf
                    ? "bg-surface-primary text-primary font-medium shadow-sm"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      }
      className="mb-6"
    >
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <defs>
            <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={c.perfBalance} stopOpacity={0.3} />
              <stop offset="95%" stopColor={c.perfBalance} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.mcAxis }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.mcAxis }}
            tickFormatter={compactCurrency}
            width={65}
            domain={["auto", "auto"]}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              const val =
                active && payload?.length
                  ? (payload[0]!.payload as ChartPoint).total
                  : null;
              // Sync hover value via ref + deferred state update to avoid render-during-render
              if (hoverRef.current !== val) {
                hoverRef.current = val;
                queueMicrotask(() => setHoverValue(val));
              }
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as ChartPoint;
              return (
                <div className="bg-surface-primary rounded-lg border p-2.5 text-xs shadow-lg">
                  <div className="text-primary mb-1 font-medium">{p.date}</div>
                  <div className="text-secondary">
                    {formatCurrency(p.total)}
                  </div>
                  {p.change !== null && (
                    <div
                      className={
                        p.change >= 0 ? "text-green-600" : "text-red-600"
                      }
                    >
                      {p.change >= 0 ? "+" : ""}
                      {formatCurrency(p.change)}
                      {p.changePct !== null && (
                        <span className="ml-1">
                          ({p.change >= 0 ? "+" : ""}
                          {formatPercent(p.changePct / 100, 1)})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            }}
          />
          {hoverValue !== null && (
            <ReferenceLine
              y={hoverValue}
              stroke={CHART_COLORS.mcAxis}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              label={{
                value: compactCurrency(hoverValue),
                position: "right",
                fontSize: CHART_FONT.label,
                fill: CHART_COLORS.mcAxis,
              }}
            />
          )}
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="total"
            stroke={c.perfBalance}
            strokeWidth={2}
            fill="url(#portfolioGradient)"
            dot={
              chartData.length <= 52 ? { r: 2.5, fill: c.perfBalance } : false
            }
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
