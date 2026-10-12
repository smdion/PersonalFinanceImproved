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
  stackedSeries,
  type StackedSnapshot,
} from "@/lib/pure/snapshot-series";
import {
  formatCurrency,
  formatPercent,
  compactCurrency,
} from "@/lib/utils/format";
import {
  CHART_COLORS,
  chartLinePalette,
  FUND_COLORS,
} from "@/lib/utils/colors";
import { useTheme } from "@/lib/hooks/use-theme";
import { safeDivide } from "@/lib/utils/math";
import { localDateStr } from "@/lib/utils/date";
import { CHART_FONT } from "@/components/charts/chart-defaults";

type TimeFrame = "YTD" | "3M" | "6M" | "1Y" | "3Y" | "All";
const TIME_FRAMES: TimeFrame[] = ["YTD", "3M", "6M", "1Y", "3Y", "All"];

type SnapshotPoint = {
  date: string;
  total: number;
  /** Amount per tracked account (see networth.listSnapshotTotals). */
  byAccount?: StackedSnapshot["byAccount"];
};

type ChartMode = "total" | "account";

type ChartPoint = {
  date: string;
  label: string;
  /** Snapshot total; null on a live-estimate day. */
  total: number | null;
  change: number | null;
  changePct: number | null;
  /** Live estimate: the last snapshot plus how linked accounts moved since. */
  live?: number;
  liveAccounts?: number;
};

/** A day after the latest snapshot: change from it across fully linked accounts. */
export type LivePoint = { date: string; change: number; accounts: number };

const shortLabel = (date: string) =>
  new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });

function getTimeFrameCutoff(tf: TimeFrame): string | null {
  if (tf === "All") return null;
  if (tf === "YTD") {
    return `${new Date().getFullYear()}-01-01`;
  }
  const months = { "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[tf];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  // Local day — compared against `s.date` (a date-only value); a UTC render
  // would move the cutoff a day every evening in a US timezone.
  return localDateStr(cutoff);
}

export function PortfolioChart({
  snapshots,
  live = [],
}: {
  snapshots: SnapshotPoint[];
  /** Days after the latest snapshot (see investments.getLiveSinceSnapshot). */
  live?: LivePoint[];
}) {
  const c = {
    ...CHART_COLORS,
    ...chartLinePalette(useTheme().resolvedTheme === "dark"),
  };
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1Y");
  const [mode, setMode] = useState<ChartMode>("total");
  const canStack = snapshots.some((s) => (s.byAccount?.length ?? 0) > 0);
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
      return {
        date: s.date,
        label: shortLabel(s.date),
        total: s.total,
        change,
        changePct,
      } satisfies ChartPoint;
    });
  }, [snapshots, timeFrame]);

  const stacked = useMemo(() => {
    const cutoffStr = getTimeFrameCutoff(timeFrame);
    return stackedSeries(
      snapshots
        .filter((s) => cutoffStr === null || s.date >= cutoffStr)
        .map((s) => ({ date: s.date, byAccount: s.byAccount ?? [] })),
    );
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
  const totalChange = (last.total ?? 0) - (first.total ?? 0);
  const totalChangePct = safeDivide(totalChange, first.total ?? 0, 0) * 100;

  // The dashed live line starts at the latest snapshot (when it's in view).
  const latest = snapshots.at(-1);
  const liveAfter =
    latest && last.date === latest.date
      ? live.filter((p) => p.date > latest.date)
      : [];
  const renderData: ChartPoint[] =
    liveAfter.length > 0
      ? [
          ...chartData.slice(0, -1),
          { ...last, live: last.total ?? undefined },
          ...liveAfter.map((p) => ({
            date: p.date,
            label: shortLabel(p.date),
            total: null,
            change: null,
            changePct: null,
            live: Math.round((latest!.total + p.change) * 100) / 100,
            liveAccounts: p.accounts,
          })),
        ]
      : chartData;
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
          {canStack && (
            <div className="bg-surface-elevated flex gap-0.5 rounded-md p-0.5">
              {(["total", "account"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`text-label rounded px-2 py-0.5 transition-colors ${
                    mode === m
                      ? "bg-surface-primary text-primary font-medium shadow-sm"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  {m === "total" ? "Total" : "By account"}
                </button>
              ))}
            </div>
          )}
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
      {mode === "account" && canStack ? (
        <StackedByAccount stacked={stacked} />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart
            data={renderData}
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          >
            <defs>
              <linearGradient
                id="portfolioGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={c.perfBalance} stopOpacity={0.3} />
                <stop
                  offset="95%"
                  stopColor={c.perfBalance}
                  stopOpacity={0.05}
                />
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
                const hovered =
                  active && payload?.length
                    ? (payload[0]!.payload as ChartPoint)
                    : null;
                const val = hovered
                  ? (hovered.total ?? hovered.live ?? null)
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
                    <div className="text-primary mb-1 font-medium">
                      {p.date}
                    </div>
                    <div className="text-secondary">
                      {p.total !== null
                        ? formatCurrency(p.total)
                        : `≈ ${formatCurrency(p.live ?? 0)}`}
                    </div>
                    {p.total === null && (
                      <div className="text-faint">
                        Live estimate: last snapshot plus how {p.liveAccounts}{" "}
                        linked account
                        {p.liveAccounts === 1 ? "" : "s"} moved
                      </div>
                    )}
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
            {liveAfter.length > 0 && (
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="live"
                stroke={c.perfBalance}
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
                dot={false}
                activeDot={{ r: 4 }}
                name="Live estimate"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

/** Each tracked account's snapshot amounts, stacked (largest at the bottom). */
function StackedByAccount({
  stacked,
}: {
  stacked: ReturnType<typeof stackedSeries>;
}) {
  const colorOf = (i: number) => FUND_COLORS[i % FUND_COLORS.length]!;
  // The account band under the mouse: drawn stronger, and picked out in the
  // tooltip and legend.
  const [hovered, setHovered] = useState<string | null>(null);
  const rows: (Record<string, number | string> & {
    date: string;
    label: string;
  })[] = stacked.rows.map((r) => ({ ...r, label: shortLabel(r.date) }));
  return (
    <>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={rows}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
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
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as (typeof rows)[number];
              const total = stacked.series.reduce(
                (t, s) => t + Number(row[s.key] ?? 0),
                0,
              );
              return (
                <div className="bg-surface-primary rounded-lg border p-2.5 text-xs shadow-lg">
                  <div className="text-primary mb-1 font-medium">
                    {row.date} · {formatCurrency(total)}
                  </div>
                  {[...stacked.series].reverse().map((s) => {
                    const i = stacked.series.indexOf(s);
                    const on = s.key === hovered;
                    return (
                      <div
                        key={s.key}
                        className={`flex justify-between gap-3 rounded px-1 ${
                          on
                            ? "bg-surface-elevated text-primary font-semibold"
                            : hovered
                              ? "text-faint"
                              : "text-secondary"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: colorOf(i) }}
                          />
                          {s.label}
                        </span>
                        <span>{formatCurrency(Number(row[s.key] ?? 0))}</span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          {stacked.series.map((s, i) => (
            <Area
              key={s.key}
              isAnimationActive={false}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="accounts"
              stroke={colorOf(i)}
              strokeWidth={s.key === hovered ? 2 : 1}
              fill={colorOf(i)}
              fillOpacity={
                hovered === null ? 0.55 : s.key === hovered ? 0.9 : 0.2
              }
              dot={false}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="text-caption text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {stacked.series.map((s, i) => (
          <span
            key={s.key}
            className={`inline-flex items-center gap-1 ${
              s.key === hovered ? "text-primary font-semibold" : ""
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: colorOf(i) }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </>
  );
}
