"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { StrategyGuideButton } from "@/components/cards/strategy-guide-panel";
import { trpc } from "@/lib/trpc";
import {
  formatCurrency,
  compactCurrency,
  formatPercent,
} from "@/lib/utils/format";
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
  budgetStabilityRate: number | null;
  yearByYear: { age: number; withdrawal: number; endBalance: number }[];
};

type AnalyzerInput = {
  salaryOverrides?: { personId: number; salary: number }[];
  contributionProfileId?: number;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  snapshotId?: number;
};

type Props = {
  strategies: StrategyResult[];
  activeStrategy: string | null;
  retirementAge: number;
  dollarMode: "nominal" | "real";
  onDollarModeChange: (mode: "nominal" | "real") => void;
  inflationRate: number;
  currentAge: number;
  analyzerInput?: AnalyzerInput;
};

type ChartMetric = "endBalance" | "withdrawal";

export function WithdrawalComparisonCard({
  strategies,
  activeStrategy,
  retirementAge,
  dollarMode,
  onDollarModeChange,
  inflationRate,
  currentAge,
  analyzerInput,
}: Props) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("endBalance");
  const [analyzerEnabled, setAnalyzerEnabled] = useState(false);

  // Analyzer query — only runs when user opts in
  const analyzerQuery = trpc.projection.analyzeStrategy.useQuery(
    analyzerInput ?? {},
    { enabled: analyzerEnabled && !!analyzerInput },
  );

  if (strategies.length === 0) return null;

  // Deflate a future-dollar value to today's dollars
  const deflate = (value: number, age: number) => {
    if (dollarMode === "nominal") return value;
    const yearsOut = age - currentAge;
    return yearsOut > 0 ? value / Math.pow(1 + inflationRate, yearsOut) : value;
  };

  // For summary stats (Year 1, Avg, Min, Max, Legacy), use retirement age as baseline
  const deflateSummary = (value: number) => deflate(value, retirementAge);

  // Build chart data: merge all strategies into age-indexed rows
  const chartData = (() => {
    const ageMap = new Map<number, Record<string, number>>();
    for (const s of strategies) {
      for (const pt of s.yearByYear) {
        if (!ageMap.has(pt.age)) ageMap.set(pt.age, { age: pt.age });
        const raw =
          chartMetric === "endBalance" ? pt.endBalance : pt.withdrawal;
        ageMap.get(pt.age)![s.strategy] = deflate(raw, pt.age);
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
      defaultOpen={true}
      headerRight={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
            <button
              type="button"
              onClick={() => onDollarModeChange("real")}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                dollarMode === "real"
                  ? "bg-surface-primary text-primary shadow-sm border"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Today&apos;s $
            </button>
            <button
              type="button"
              onClick={() => onDollarModeChange("nominal")}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                dollarMode === "nominal"
                  ? "bg-surface-primary text-primary shadow-sm border"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Future $
            </button>
          </div>
          <StrategyGuideButton />
        </div>
      }
    >
      {/* Table */}
      {
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-faint border-b">
                <th className="text-left py-1.5 pr-2 font-medium">Strategy</th>
                <th className="text-right py-1.5 px-2 font-medium">
                  Depletion Age
                </th>
                <th className="text-right py-1.5 px-2 font-medium">
                  <span title="Portfolio survives to end of plan — balance stays above $0 in every year (200 Monte Carlo simulations)">
                    Success
                  </span>
                </th>
                <th className="text-right py-1.5 px-2 font-medium">
                  <span title="% of scenarios where spending never drops below 75% of the strategy's own year-1 withdrawal (inflation-adjusted). Measures self-consistency.">
                    Stab. (Strat)
                  </span>
                </th>
                <th className="text-right py-1.5 px-2 font-medium">
                  <span title="% of scenarios where spending never drops below 75% of your stated retirement budget (inflation-adjusted). Measures whether your actual needs are met.">
                    Stab. (Budget)
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
                          {formatPercent(s.successRate)}
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
                          {formatPercent(s.spendingStabilityRate)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {s.budgetStabilityRate !== null ? (
                        <span
                          className={
                            s.budgetStabilityRate >= 0.9
                              ? "text-green-400"
                              : s.budgetStabilityRate >= 0.7
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {formatPercent(s.budgetStabilityRate)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(deflateSummary(s.year1Withdrawal))}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(deflateSummary(s.avgAnnualWithdrawal))}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(deflateSummary(s.minAnnualWithdrawal))}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-faint">
                      {formatCurrency(deflateSummary(s.maxAnnualWithdrawal))}
                    </td>
                    <td className="text-right py-1.5 pl-2 tabular-nums text-faint">
                      {formatCurrency(deflateSummary(s.legacyAmount))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      }

      {/* Chart */}
      {
        <div className="mt-6 pt-4 border-t">
          <div className="flex justify-end gap-1 mb-3">
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
                tickFormatter={(v: number) => compactCurrency(v)}
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
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 16 }} />
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
      }
      {/* Strategy Analyzer — opt-in */}
      <div className="mt-4 pt-3 border-t">
        {!analyzerEnabled ? (
          <div className="flex justify-end">
            <button
              onClick={() => setAnalyzerEnabled(true)}
              className="text-[11px] text-sky-400 hover:text-sky-300 border border-sky-400/30 hover:border-sky-400/60 rounded px-2 py-0.5 transition-colors"
            >
              Analyze My Strategy →
            </button>
          </div>
        ) : analyzerQuery.isLoading ? (
          <div className="text-xs text-faint animate-pulse text-center py-3">
            Running scenario analysis...
          </div>
        ) : analyzerQuery.data?.recommendations &&
          analyzerQuery.data.recommendations.length > 0 ? (
          <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-primary">
                  Strategy Analysis — {analyzerQuery.data.strategyLabel}
                </h4>
                <p className="text-[11px] text-faint">
                  Current plan:{" "}
                  {formatPercent(analyzerQuery.data.baseline?.successRate ?? 0)}{" "}
                  success ·{" "}
                  {formatPercent(
                    analyzerQuery.data.baseline?.stabilityRate ?? 0,
                  )}{" "}
                  stability
                </p>
              </div>
              <button
                onClick={() => setAnalyzerEnabled(false)}
                className="text-[10px] text-faint hover:text-secondary"
              >
                Dismiss
              </button>
            </div>

            <div className="space-y-2">
              {analyzerQuery.data.recommendations.map((rec, i) => {
                const successDeltaPp = Math.round(rec.successDelta * 100);
                const stabilityDeltaPp = Math.round(rec.stabilityDelta * 100);
                return (
                  <div
                    key={rec.label}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span className="text-sky-400 font-bold shrink-0">
                      {i + 1}.
                    </span>
                    <div>
                      <span className="text-secondary">
                        {rec.label}: {rec.currentValue} → {rec.adjustedValue}
                      </span>
                      <div className="text-faint mt-0.5">
                        Success: {formatPercent(rec.successRate)}
                        {successDeltaPp !== 0 && (
                          <span
                            className={
                              successDeltaPp > 0
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {" "}
                            ({successDeltaPp > 0 ? "+" : ""}
                            {successDeltaPp}pp)
                          </span>
                        )}
                        {" · "}Stability: {formatPercent(rec.stabilityRate)}
                        {stabilityDeltaPp !== 0 && (
                          <span
                            className={
                              stabilityDeltaPp > 0
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {" "}
                            ({stabilityDeltaPp > 0 ? "+" : ""}
                            {stabilityDeltaPp}pp)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-faint mt-3">
              Full engine assumptions used with only the stated change. 200
              Monte Carlo simulations each.
            </p>
          </div>
        ) : analyzerQuery.data?.diagnosis === "healthy" ? (
          <div className="rounded-lg border border-green-500/20 bg-green-950/20 p-3 text-xs text-faint">
            Your strategy is well-optimized — no single parameter change
            produces a meaningful improvement (&gt;2pp). Consider broader
            changes like increasing guaranteed income or adjusting your
            timeline.
            <button
              onClick={() => setAnalyzerEnabled(false)}
              className="ml-2 text-[10px] text-faint hover:text-secondary"
            >
              Dismiss
            </button>
          </div>
        ) : analyzerQuery.data ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-faint">
            No parameter changes produce a meaningful improvement (&gt;2pp) for
            your current configuration. The biggest gains would come from
            changes outside strategy parameters (saving more, delaying
            retirement, increasing guaranteed income).
            <button
              onClick={() => setAnalyzerEnabled(false)}
              className="ml-2 text-[10px] text-faint hover:text-secondary"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
