"use client";

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
import { formatCurrency, formatPercent, compactCurrency } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";

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
      const changePct =
        prev && prev.total > 0 ? (change! / prev.total) * 100 : null;
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
        <p className="text-sm text-faint">
          No snapshot data for the selected time frame.
        </p>
      </Card>
    );
  }

  const first = chartData[0]!;
  const last = chartData[chartData.length - 1]!;
  const totalChange = last.total - first.total;
  const totalChangePct =
    first.total > 0 ? (totalChange / first.total) * 100 : 0;
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
            <span className="text-xs ml-1">
              ({isPositive ? "+" : ""}
              {totalChangePct.toFixed(1)}%)
            </span>
          </span>
          <div className="flex gap-0.5 bg-surface-elevated rounded-md p-0.5">
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeFrame(tf)}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  timeFrame === tf
                    ? "bg-surface-primary text-primary shadow-sm font-medium"
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
              <stop
                offset="5%"
                stopColor={CHART_COLORS.perfBalance}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS.perfBalance}
                stopOpacity={0.05}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: CHART_COLORS.mcAxis }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 11, fill: CHART_COLORS.mcAxis }}
            tickFormatter={compactCurrency}
            width={65}
            domain={["auto", "auto"]}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              const val = active && payload?.length
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
                <div className="bg-surface-primary border rounded-lg shadow-lg p-2.5 text-xs">
                  <div className="font-medium text-primary mb-1">{p.date}</div>
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
                          {p.changePct.toFixed(1)}%)
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
                fontSize: 10,
                fill: CHART_COLORS.mcAxis,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="total"
            stroke={CHART_COLORS.perfBalance}
            strokeWidth={2}
            fill="url(#portfolioGradient)"
            dot={
              chartData.length <= 52
                ? { r: 2.5, fill: CHART_COLORS.perfBalance }
                : false
            }
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
