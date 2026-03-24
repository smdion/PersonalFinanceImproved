"use client";

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatCurrency } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import { monthKey } from "./types";

interface FundMiniChartProps {
  balances: number[];
  monthDates: Date[];
  monthEvents: ({ amount: number; description: string }[] | null)[];
  target: number;
  fundColor: string;
  onClickMonth?: (monthIndex: number) => void;
}

interface ChartDataPoint {
  month: string;
  monthIndex: number;
  balance: number;
  negativeBalance: number | null;
  events: { amount: number; description: string }[] | null;
}

export function FundMiniChart({
  balances,
  monthDates,
  monthEvents,
  target,
  fundColor,
  onClickMonth,
}: FundMiniChartProps) {
  const data: ChartDataPoint[] = monthDates.map((d, i) => ({
    month: monthKey(d),
    monthIndex: i,
    balance: balances[i]!,
    negativeBalance: balances[i]! < 0 ? balances[i]! : null,
    events: monthEvents[i] ?? null,
  }));

  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances, target || 0);
  const yMin = Math.min(0, minBalance) * 1.1;
  const yMax = maxBalance * 1.1;

  const hasNegative = minBalance < 0;

  return (
    <div className="w-full h-[120px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          onClick={(state) => {
            if (
              state?.activeTooltipIndex != null &&
              typeof state.activeTooltipIndex === "number" &&
              onClickMonth
            ) {
              onClickMonth(state.activeTooltipIndex);
            }
          }}
        >
          <defs>
            <linearGradient
              id={`grad-${fundColor.replace("#", "")}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={fundColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={fundColor} stopOpacity={0.05} />
            </linearGradient>
            {hasNegative && (
              <linearGradient id="grad-negative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} />
              </linearGradient>
            )}
          </defs>

          <XAxis
            dataKey="month"
            tick={{ fontSize: 9, fill: CHART_COLORS.mcAxis }}
            tickLine={false}
            axisLine={false}
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
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: CHART_COLORS.mcAxis }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => {
              const n = Number(v);
              if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}k`;
              return `$${n.toFixed(0)}`;
            }}
            width={45}
          />

          <RechartsTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as ChartDataPoint;
              const labelStr = String(label);
              const [y, m] = labelStr.split("-");
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
              return (
                <div className="bg-surface-primary border rounded-md px-2.5 py-1.5 text-xs shadow-lg">
                  <p className="text-secondary font-medium">
                    {months[parseInt(m!) - 1]} {y}
                  </p>
                  <p
                    className={`font-semibold ${point.balance < 0 ? "text-red-600" : "text-primary"}`}
                  >
                    {formatCurrency(point.balance)}
                  </p>
                  {point.events?.map((ev) => (
                    <p
                      key={`${ev.description}-${ev.amount}`}
                      className={`text-[10px] ${ev.amount < 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {ev.description}: {ev.amount >= 0 ? "+" : ""}
                      {formatCurrency(ev.amount)}
                    </p>
                  ))}
                </div>
              );
            }}
          />

          {/* Zero line */}
          <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 3" />

          {/* Target line */}
          {target > 0 && (
            <ReferenceLine
              y={target}
              stroke="#10b981"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{
                value: `Target: ${formatCurrency(target)}`,
                position: "right",
                fill: "#10b981",
                fontSize: 9,
              }}
            />
          )}

          {/* Positive balance area */}
          <Area
            type="monotone"
            dataKey="balance"
            stroke={fundColor}
            strokeWidth={2}
            fill={`url(#grad-${fundColor.replace("#", "")})`}
            dot={(props) => {
              const { cx, cy, payload, index } = props as {
                cx: number;
                cy: number;
                payload: ChartDataPoint;
                index: number;
              };
              if (!payload?.events?.length) return <g key={index} />;
              const hasWithdrawal = payload.events.some(
                (e: { amount: number }) => e.amount < 0,
              );
              return (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={hasWithdrawal ? "#ef4444" : "#10b981"}
                  stroke="#1f2937"
                  strokeWidth={1.5}
                />
              );
            }}
            activeDot={{
              r: 4,
              stroke: fundColor,
              strokeWidth: 2,
              fill: "#1f2937",
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
