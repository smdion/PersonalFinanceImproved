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
    dotFill: dark ? "#1f2937" : "#ffffff",
    refLine: dark ? "#6b7280" : "#9ca3af",
  };
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
            Click a fund in the legend to scroll to its detail card
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
              return `${months[parseInt(m!) - 1]} '${y!.slice(2)}`;
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
            contentStyle={{
              fontSize: 11,
              backgroundColor: p.tooltipBg,
              border: `1px solid ${p.tooltipBorder}`,
              borderRadius: 6,
              color: p.tooltipText,
            }}
            labelFormatter={(label) => {
              const str = String(label);
              const [y, m] = str.split("-");
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
              return `${months[parseInt(m!) - 1]} ${y}`;
            }}
            formatter={(value, name) => [
              formatCurrency(Number(value)),
              String(name),
            ]}
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

          {/* Target reference lines for each fund */}
          {goalProjections.map((gp, i) => {
            if (gp.target <= 0) return null;
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
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: color,
                  strokeWidth: 2,
                  fill: p.dotFill,
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
