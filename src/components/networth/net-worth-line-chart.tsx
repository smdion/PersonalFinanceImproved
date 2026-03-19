"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CHART_COLORS } from "@/lib/utils/colors";
import { compactCurrency, type HistoryRow } from "./types";

export function NetWorthLineChart({ history }: { history: HistoryRow[] }) {
  return (
    <Card
      title={
        <>
          Net Worth Over Time{" "}
          <HelpTip text="Multi-line view: Net Worth (green), Portfolio (red), House (blue), Cash (amber), Liabilities (purple). Current year marked with *." />
        </>
      }
      className="mb-8"
    >
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={history}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12, fill: CHART_COLORS.mcAxis }}
            tickFormatter={(y: number) => {
              const row = history.find((h) => h.year === y);
              return row?.isCurrent ? `${y}*` : String(y);
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: CHART_COLORS.mcAxis }}
            tickFormatter={compactCurrency}
            width={65}
          />
          <RechartsTooltip
            formatter={(value, name) => [
              formatCurrency(Number(value)),
              String(name),
            ]}
            labelFormatter={(label: unknown) => {
              const yr = Number(label);
              const row = history.find((h) => h.year === yr);
              return row?.isCurrent ? `${yr} (YTD)` : String(yr);
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, lineHeight: "1.5", paddingTop: 4 }}
          />
          <Line
            type="monotone"
            dataKey="netWorth"
            name="Net Worth"
            stroke={CHART_COLORS.netWorth}
            strokeWidth={3}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="portfolioTotal"
            name="Portfolio"
            stroke={CHART_COLORS.portfolio}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="houseValue"
            name="House"
            stroke={CHART_COLORS.house}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="cash"
            name="Cash"
            stroke={CHART_COLORS.cash}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="totalLiabilities"
            name="Liabilities"
            stroke={CHART_COLORS.liabilities}
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
