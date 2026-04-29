"use client";

import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, compactCurrency } from "@/lib/utils/format";
import { useTheme } from "@/lib/hooks/use-theme";
import { GoalProjection, monthKey } from "./types";
import { FUND_COLORS } from "./fund-colors";

interface TrajectoryDataPoint {
  month: string;
  [fundName: string]: number | string;
}

/** Theme-aware chart palette — keeps hex values out of JSX. */
function useChartPalette() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return {
    bg: "bg-surface-primary",
    title: "text-primary",
    subtitle: "text-muted",
    negBadgeBg: "bg-red-50",
    negBadgeBorder: "border-red-200",
    negBadgeText: "text-red-600",
    grid: dark ? "#374151" : "#e5e7eb",
    axis: dark ? "#9ca3af" : "#6b7280",
    axisLine: dark ? "#4b5563" : "#d1d5db",
    tooltipBg: dark ? "#1f2937" : "#ffffff",
    tooltipBorder: dark ? "#374151" : "#e5e7eb",
    tooltipText: dark ? "#e5e7eb" : "#1f2937",
    tooltipMuted: dark ? "#9ca3af" : "#6b7280",
    dotFill: dark ? "#1f2937" : "#ffffff",
    refLine: dark ? "#6b7280" : "#9ca3af",
  };
}

const MONTH_LABELS = [
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

function formatMonthKey(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_LABELS[parseInt(m!) - 1]} ${y}`;
}

// Custom tooltip showing balances + any events that month
function EventTooltip({
  active,
  payload,
  label,
  goalProjections,
  monthDates,
  p,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  goalProjections: GoalProjection[];
  monthDates: Date[];
  p: ReturnType<typeof useChartPalette>;
}) {
  if (!active || !payload?.length || !label) return null;

  const monthIdx = monthDates.findIndex((d) => monthKey(d) === label);

  return (
    <div
      style={{
        background: p.tooltipBg,
        border: `1px solid ${p.tooltipBorder}`,
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 11,
        color: p.tooltipText,
        minWidth: 160,
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 6 }}>
        {formatMonthKey(label)}
      </p>
      {payload.map((entry) => {
        const gp = goalProjections.find((g) => g.name === entry.name);
        const events =
          monthIdx >= 0 && gp ? (gp.monthEvents[monthIdx] ?? []) : [];
        return (
          <div key={entry.name} style={{ marginBottom: events.length ? 4 : 2 }}>
            <span style={{ color: entry.color }}>
              ● {entry.name}:{" "}
              <span style={{ fontWeight: 600 }}>
                {formatCurrency(entry.value)}
              </span>
            </span>
            {events.map((ev) => (
              <div
                key={ev.id}
                style={{
                  paddingLeft: 12,
                  color: ev.amount < 0 ? "#f87171" : "#4ade80",
                  fontSize: 10,
                  marginTop: 1,
                }}
              >
                {ev.description}: {ev.amount < 0 ? "−" : "+"}
                {formatCurrency(Math.abs(ev.amount))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function SavingsTrajectoryChart({
  goalProjections,
  monthDates,
  onFundClick,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  onFundClick?: (fundName: string) => void;
}) {
  const p = useChartPalette();

  // Build chart data: each month has a value per fund
  const data: TrajectoryDataPoint[] = monthDates.map((d, i) => {
    const point: TrajectoryDataPoint = { month: monthKey(d) };
    for (const gp of goalProjections) {
      point[gp.name] = gp.balances[i]!;
    }
    return point;
  });

  // Find funds that go negative for warning
  const negativeInfo = goalProjections
    .filter((gp) => gp.balances.some((b) => b < 0))
    .map((gp) => gp.name);

  return (
    <div className={`${p.bg} rounded-lg border p-3 sm:p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className={`text-sm font-semibold ${p.title}`}>
            Goal Trajectories
          </h2>
          <p className={`text-[10px] ${p.subtitle} mt-0.5`}>
            Click a fund in the legend to scroll to its detail card ·{" "}
            <span className="inline-flex items-center gap-1">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: "currentColor",
                  clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                }}
              />
              = planned transaction
            </span>
          </p>
        </div>
        {negativeInfo.length > 0 && (
          <span
            className={`text-[10px] ${p.negBadgeText} ${p.negBadgeBg} px-2 py-0.5 rounded border ${p.negBadgeBorder}`}
          >
            {negativeInfo.join(", ")}{" "}
            {negativeInfo.length === 1 ? "goes" : "go"} negative
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={p.grid} />

          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: p.axis }}
            tickLine={false}
            axisLine={{ stroke: p.axisLine }}
            interval="preserveStartEnd"
            tickFormatter={(v: string) => {
              const [y, m] = v.split("-");
              return `${MONTH_LABELS[parseInt(m!) - 1]} '${y!.slice(2)}`;
            }}
          />

          <YAxis
            tick={{ fontSize: 10, fill: p.axis }}
            tickLine={false}
            axisLine={{ stroke: p.axisLine }}
            tickFormatter={(v) => compactCurrency(Number(v))}
            width={55}
          />

          <RechartsTooltip
            content={(tooltipProps) => (
              <EventTooltip
                // eslint-disable-next-line no-restricted-syntax -- Recharts TooltipProps has readonly payload array incompatible with EventTooltip's mutable signature; no typed wrapper available
                {...(tooltipProps as unknown as {
                  active?: boolean;
                  payload?: { name: string; value: number; color: string }[];
                  label?: string;
                })}
                goalProjections={goalProjections}
                monthDates={monthDates}
                p={p}
              />
            )}
          />

          <Legend
            wrapperStyle={{
              fontSize: 11,
              cursor: "pointer",
              lineHeight: "1.5",
              paddingTop: 4,
            }}
            onClick={(e) => {
              if (onFundClick && e.value) onFundClick(String(e.value));
            }}
          />

          {/* Zero reference line */}
          <ReferenceLine y={0} stroke={p.refLine} strokeDasharray="4 4" />

          {/* Target reference lines for fixed-target funds only */}
          {goalProjections.map((gp, i) => {
            if (gp.targetMode !== "fixed" || gp.target <= 0) return null;
            const color = FUND_COLORS[i % FUND_COLORS.length]!;
            return (
              <ReferenceLine
                key={`target-${gp.name}`}
                y={gp.target}
                stroke={color}
                strokeDasharray="6 3"
                strokeWidth={1}
                strokeOpacity={0.4}
              />
            );
          })}

          {goalProjections.map((gp, i) => {
            const color = FUND_COLORS[i % FUND_COLORS.length]!;
            return (
              <Line
                key={gp.name}
                type="monotone"
                dataKey={gp.name}
                stroke={color}
                strokeWidth={2}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dot={(dotProps: any) => {
                  const {
                    cx = 0,
                    cy = 0,
                    index,
                  } = dotProps as { cx?: number; cy?: number; index: number };
                  const events = gp.monthEvents[index];
                  if (!events?.length)
                    return <g key={`no-ev-${gp.name}-${index}`} />;
                  const s = 5;
                  return (
                    <g key={`ev-${gp.name}-${index}`}>
                      {/* Enlarged invisible hit area */}
                      <rect
                        x={cx - 12}
                        y={cy - 12}
                        width={24}
                        height={24}
                        fill="transparent"
                      />
                      {/* Diamond marker */}
                      <polygon
                        points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
                        fill={color}
                        stroke={p.dotFill}
                        strokeWidth={1.5}
                      />
                    </g>
                  );
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                activeDot={(dotProps: any) => {
                  const {
                    cx = 0,
                    cy = 0,
                    index,
                  } = dotProps as { cx?: number; cy?: number; index: number };
                  const events = gp.monthEvents[index];
                  const s = 6;
                  if (events?.length) {
                    return (
                      <g key={`active-ev-${gp.name}-${index}`}>
                        <polygon
                          points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
                          fill={color}
                          stroke={p.dotFill}
                          strokeWidth={2}
                        />
                      </g>
                    );
                  }
                  return (
                    <circle
                      key={`active-${gp.name}-${index}`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      stroke={color}
                      strokeWidth={2}
                      fill={p.dotFill}
                    />
                  );
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
