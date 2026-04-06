"use client";

import { useMemo } from "react";
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
import {
  WEALTH_FORMULA_BASE_DENOMINATOR,
  WEALTH_FORMULA_MULTIPLIER,
} from "@/lib/constants";
import { compactCurrency, type HistoryRow } from "./types";

export function JourneyToAbundanceChart({
  history,
  primaryBirthYear,
}: {
  history: HistoryRow[];
  primaryBirthYear: number;
}) {
  const chartData = useMemo(() => {
    // Compute average gross income across years that have income data
    const yearsWithIncome = history.filter((h) => h.grossIncome > 0);
    const avgIncome =
      yearsWithIncome.length > 0
        ? yearsWithIncome.reduce((s, h) => s + h.grossIncome, 0) /
          yearsWithIncome.length
        : 0;

    return history.map((h) => {
      const age = h.year - primaryBirthYear;
      const avgWealth =
        avgIncome > 0 ? (age * avgIncome) / WEALTH_FORMULA_BASE_DENOMINATOR : 0;
      return {
        year: h.year,
        age,
        netWorth: h.netWorth,
        portfolio: h.portfolioTotal,
        avgWealth,
        prodigiousWealth: avgWealth * WEALTH_FORMULA_MULTIPLIER,
      };
    });
  }, [history, primaryBirthYear]);

  if (chartData.length < 2) return null;

  // Check if we have income data for the benchmarks
  const hasIncome = chartData.some((d) => d.avgWealth > 0);

  return (
    <Card
      title={
        <>
          Journey to Abundance{" "}
          <HelpTip text="From The Millionaire Next Door: Average Accumulator of Wealth = Age x Average Income / 10. Prodigious = 2x that. Lines show your portfolio and net worth against these benchmarks." />
        </>
      }
      className="mb-8"
    >
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 12, fill: CHART_COLORS.mcAxis }}
            label={{
              value: "Age",
              position: "insideBottom",
              offset: -2,
              fontSize: 12,
            }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: CHART_COLORS.mcAxis }}
            tickFormatter={compactCurrency}
            width={65}
          />
          <RechartsTooltip
            formatter={(value: unknown) => [
              formatCurrency(Number(value)),
              undefined,
            ]}
            labelFormatter={(label: unknown) => `Age ${label}`}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, lineHeight: "1.5", paddingTop: 4 }}
          />
          {hasIncome && (
            <Line
              type="monotone"
              dataKey="avgWealth"
              name="Avg Wealth"
              stroke={CHART_COLORS.avgWealth}
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={false}
            />
          )}
          {hasIncome && (
            <Line
              type="monotone"
              dataKey="prodigiousWealth"
              name="Prodigious Wealth"
              stroke={CHART_COLORS.prodigiousWealth}
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="portfolio"
            name="Portfolio"
            stroke={CHART_COLORS.portfolio}
            strokeWidth={2}
            dot={{ r: 3 }}
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
        </LineChart>
      </ResponsiveContainer>
      {!hasIncome && (
        <p className="text-xs text-faint mt-2">
          Add gross income to annual net worth records to see wealth benchmark
          lines.
        </p>
      )}
    </Card>
  );
}
