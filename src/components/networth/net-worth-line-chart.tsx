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

export type ChartXAxisMode = "year" | "age";

export function NetWorthLineChart({
  history,
  xAxisMode = "year",
  primaryBirthYear,
}: {
  history: HistoryRow[];
  xAxisMode?: ChartXAxisMode;
  primaryBirthYear?: number | null;
}) {
  const useAge = xAxisMode === "age";
  // Add displayAge for X-axis when in age mode
  const chartData = useAge
    ? history.map((h) => ({
        ...h,
        displayAge: primaryBirthYear ? h.year - primaryBirthYear : h.averageAge,
      }))
    : history;

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
          data={chartData}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey={useAge ? "displayAge" : "year"}
            tick={{ fontSize: 12, fill: CHART_COLORS.mcAxis }}
            tickFormatter={(v: number) => {
              if (useAge) return String(v);
              const row = history.find((h) => h.year === v);
              return row?.isCurrent ? `${v}*` : String(v);
            }}
            label={
              useAge
                ? {
                    value: "Age",
                    position: "insideBottom",
                    offset: -2,
                    fontSize: 12,
                  }
                : undefined
            }
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
              const num = Number(label);
              if (useAge) return `Age ${num}`;
              const row = history.find((h) => h.year === num);
              return row?.isCurrent ? `${num} (YTD)` : String(num);
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
