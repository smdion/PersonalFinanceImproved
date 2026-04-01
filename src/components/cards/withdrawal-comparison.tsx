"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// 8 distinct colors for strategies
const STRATEGY_COLORS = [
  "#4f46e5", // indigo-600
  "#ef4444", // red-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#3b82f6", // blue-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
];

type StrategyResult = {
  strategy: string;
  label: string;
  shortLabel: string;
  portfolioDepletionAge: number | null;
  sustainableWithdrawal: number;
  year1Withdrawal: number;
  avgAnnualWithdrawal: number;
  minAnnualWithdrawal: number;
  maxAnnualWithdrawal: number;
  endBalance: number;
  legacyAmount: number;
  successRate: number | null;
  spendingStabilityRate: number | null;
  yearByYear: { age: number; withdrawal: number; endBalance: number }[];
};

type Props = {
  strategies: StrategyResult[];
  activeStrategy: string | null;
  retirementAge: number;
};

type ChartMetric = "endBalance" | "withdrawal";

export function WithdrawalComparisonCard({
  strategies,
  activeStrategy,
  retirementAge,
}: Props) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("endBalance");

  if (strategies.length === 0) return null;

  // Build chart data: merge all strategies into age-indexed rows
  const chartData = (() => {
    const ageMap = new Map<number, Record<string, number>>();
    for (const s of strategies) {
      for (const pt of s.yearByYear) {
        if (!ageMap.has(pt.age)) ageMap.set(pt.age, { age: pt.age });
        ageMap.get(pt.age)![s.strategy] =
          chartMetric === "endBalance" ? pt.endBalance : pt.withdrawal;
      }
    }
    return Array.from(ageMap.values()).sort(
      (a, b) => (a.age ?? 0) - (b.age ?? 0),
    );
  })();

  return (
    <Card
      title="Withdrawal Strategy Comparison"
      subtitle={`Comparing ${strategies.length} strategies from age ${retirementAge} · Success % via Monte Carlo`}
      className="mb-6"
      collapsible
      defaultOpen={false}
      headerRight={
        <div className="flex gap-1">
          <button
            onClick={() => setView("table")}
            className={`px-2 py-0.5 text-[10px] rounded ${view === "table" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
          >
            Table
          </button>
          <button
            onClick={() => setView("chart")}
            className={`px-2 py-0.5 text-[10px] rounded ${view === "chart" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
          >
            Chart
          </button>
        </div>
      }
    >
      {view === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-faint border-b">
                <th className="text-left py-1.5 pr-2 font-medium">Strategy</th>
                <th className="text-right py-1.5 px-2 font-medium">
                  Depletion Age
                </th>
                <th className="text-right py-1.5 px-2 font-medium">
                  <span title="Portfolio survives to end of plan — balance stays above $0 in every year (200 MC trials)">
                    Success
                  </span>
                </th>
                <th className="text-right py-1.5 px-2 font-medium">
                  <span title="Withdrawals stay at or above 75% of the initial year-1 withdrawal (inflation-adjusted) in every retirement year (200 MC trials). Shows how often the strategy maintains your planned income level.">
                    Stability
                  </span>
                </th>
                <th className="text-right py-1.5 px-2 font-medium">Year 1</th>
                <th className="text-right py-1.5 px-2 font-medium">Avg/yr</th>
                <th className="text-right py-1.5 px-2 font-medium">Min/yr</th>
                <th className="text-right py-1.5 px-2 font-medium">Max/yr</th>
                <th className="text-right py-1.5 pl-2 font-medium">Legacy</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s, i) => {
                const isActive = s.strategy === activeStrategy;
                return (
                  <tr
                    key={s.strategy}
                    className={`border-b ${isActive ? "bg-blue-900/20" : ""}`}
                  >
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor:
                              STRATEGY_COLORS[i % STRATEGY_COLORS.length],
                          }}
                        />
                        <span
                          className={`text-primary ${isActive ? "font-semibold" : ""}`}
                        >
                          {s.shortLabel}
                          {isActive && (
                            <span className="text-blue-400 text-[9px] ml-1">
                              (active)
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {s.portfolioDepletionAge ?? (
                        <span className="text-green-400">Never</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {s.successRate !== null ? (
                        <span
                          className={
                            s.successRate >= 0.9
                              ? "text-green-400"
                              : s.successRate >= 0.7
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {Math.round(s.successRate * 100)}%
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {s.spendingStabilityRate !== null ? (
                        <span
                          className={
                            s.spendingStabilityRate >= 0.9
                              ? "text-green-400"
                              : s.spendingStabilityRate >= 0.7
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {Math.round(s.spendingStabilityRate * 100)}%
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(s.year1Withdrawal)}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(s.avgAnnualWithdrawal)}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(s.minAnnualWithdrawal)}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(s.maxAnnualWithdrawal)}
                    </td>
                    <td className="text-right py-1.5 pl-2 tabular-nums text-faint">
                      {formatCurrency(s.legacyAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "chart" && (
        <div>
          <div className="flex justify-end gap-1 mb-2">
            <button
              onClick={() => setChartMetric("endBalance")}
              className={`px-2 py-0.5 text-[10px] rounded ${chartMetric === "endBalance" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
            >
              Portfolio Balance
            </button>
            <button
              onClick={() => setChartMetric("withdrawal")}
              className={`px-2 py-0.5 text-[10px] rounded ${chartMetric === "withdrawal" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
            >
              Annual Withdrawal
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="age"
                stroke="#9ca3af"
                tick={{ fontSize: 10 }}
                label={{
                  value: "Age",
                  position: "insideBottom",
                  offset: -5,
                  fontSize: 10,
                  fill: "#9ca3af",
                }}
              />
              <YAxis
                stroke="#9ca3af"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "6px",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(value) => formatCurrency(Number(value))}
                labelFormatter={(age) => `Age ${age}`}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {strategies.map((s, i) => (
                <Line
                  key={s.strategy}
                  type="monotone"
                  dataKey={s.strategy}
                  name={s.shortLabel}
                  stroke={STRATEGY_COLORS[i % STRATEGY_COLORS.length]}
                  strokeWidth={s.strategy === activeStrategy ? 2.5 : 1.5}
                  dot={false}
                  strokeDasharray={
                    s.strategy === activeStrategy ? undefined : "4 2"
                  }
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
