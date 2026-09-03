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
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { STRATEGY_COMPARISON_COLORS, CHART_COLORS } from "@/lib/utils/colors";

type StrategyResult = {
  strategy: string;
  label: string;
  shortLabel: string;
  portfolioDepletionAge: number | null;
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
  salaryActiveFields?: { personId: number; salary: number }[];
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
      subtitle={`Comparing ${strategies.length} strategies from age ${retirementAge} · Success % via simulation`}
      className="mb-6"
      isCollapsible
      isDefaultOpen={true}
      headerRight={
        <div className="flex items-center gap-2">
          <div className="bg-surface-primary/60 inline-flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => onDollarModeChange("real")}
              className={`text-caption rounded px-2 py-0.5 font-medium transition-colors ${
                dollarMode === "real"
                  ? "bg-surface-primary text-primary border shadow-sm"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Today&apos;s $
            </button>
            <button
              type="button"
              onClick={() => onDollarModeChange("nominal")}
              className={`text-caption rounded px-2 py-0.5 font-medium transition-colors ${
                dollarMode === "nominal"
                  ? "bg-surface-primary text-primary border shadow-sm"
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
                <th className="py-1.5 pr-2 text-left font-medium">Strategy</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  Depletion Age
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="Portfolio survives to end of plan — balance stays above $0 in every year (200 simulations)">
                    Success
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="% of scenarios where spending never drops below 75% of the strategy's own year-1 withdrawal (inflation-adjusted). Measures self-consistency.">
                    Stab. (Strat)
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="% of scenarios where spending never drops below 75% of your stated retirement budget (inflation-adjusted). Measures whether your actual needs are met.">
                    Stab. (Budget)
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">Year 1</th>
                <th className="px-2 py-1.5 text-right font-medium">Avg/yr</th>
                <th className="px-2 py-1.5 text-right font-medium">Min/yr</th>
                <th className="px-2 py-1.5 text-right font-medium">Max/yr</th>
                <th className="py-1.5 pl-2 text-right font-medium">Legacy</th>
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
                          className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              STRATEGY_COMPARISON_COLORS[
                                i % STRATEGY_COMPARISON_COLORS.length
                              ],
                          }}
                        />
                        <span
                          className={`text-primary ${isActive ? "font-semibold" : ""}`}
                        >
                          {s.shortLabel}
                          {isActive && (
                            <span className="text-micro ml-1 text-blue-400">
                              (active)
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {s.portfolioDepletionAge ?? (
                        <span className="text-green-400">Never</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.successRate !== null ? (
                        <span
                          className={
                            s.successRate >= 0.9
                              ? "text-green-400"
                              : s.successRate >= 0.75
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
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.spendingStabilityRate !== null ? (
                        <span
                          className={
                            s.spendingStabilityRate >= 0.9
                              ? "text-green-400"
                              : s.spendingStabilityRate >= 0.75
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
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.budgetStabilityRate !== null ? (
                        <span
                          className={
                            s.budgetStabilityRate >= 0.9
                              ? "text-green-400"
                              : s.budgetStabilityRate >= 0.75
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
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(deflateSummary(s.year1Withdrawal))}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(deflateSummary(s.avgAnnualWithdrawal))}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(deflateSummary(s.minAnnualWithdrawal))}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(deflateSummary(s.maxAnnualWithdrawal))}
                    </td>
                    <td className="text-faint py-1.5 pl-2 text-right tabular-nums">
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
        <div className="mt-6 border-t pt-4">
          <div className="mb-3 flex justify-end gap-1">
            <button
              onClick={() => setChartMetric("endBalance")}
              className={`text-caption rounded px-2 py-0.5 ${chartMetric === "endBalance" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
            >
              Portfolio Balance
            </button>
            <button
              onClick={() => setChartMetric("withdrawal")}
              className={`text-caption rounded px-2 py-0.5 ${chartMetric === "withdrawal" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
            >
              Annual Withdrawal
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={CHART_COLORS.wdComparisonGrid}
              />
              <XAxis
                dataKey="age"
                stroke={CHART_COLORS.wdComparisonAxis}
                tick={{ fontSize: CHART_FONT.tick }}
                label={{
                  value: "Age",
                  position: "insideBottom",
                  offset: -5,
                  fontSize: CHART_FONT.tick,
                  fill: CHART_COLORS.wdComparisonAxis,
                }}
              />
              <YAxis
                stroke={CHART_COLORS.wdComparisonAxis}
                tick={{ fontSize: CHART_FONT.tick }}
                tickFormatter={(v: number) => compactCurrency(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_COLORS.wdComparisonTooltipBg,
                  border: `1px solid ${CHART_COLORS.wdComparisonGrid}`,
                  borderRadius: "6px",
                  fontSize: CHART_FONT.tooltip,
                }}
                labelStyle={{ color: CHART_COLORS.wdComparisonAxis }}
                formatter={(value) => formatCurrency(Number(value))}
                labelFormatter={(age) => `Age ${age}`}
              />
              <Legend
                wrapperStyle={{ fontSize: CHART_FONT.legend, paddingTop: 16 }}
              />
              {strategies.map((s, i) => (
                <Line
                  key={s.strategy}
                  type="monotone"
                  dataKey={s.strategy}
                  name={s.shortLabel}
                  stroke={
                    STRATEGY_COMPARISON_COLORS[
                      i % STRATEGY_COMPARISON_COLORS.length
                    ]
                  }
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
      <div className="mt-4 border-t pt-3">
        {!analyzerEnabled ? (
          <div className="flex justify-end">
            <button
              onClick={() => setAnalyzerEnabled(true)}
              className="text-label rounded border border-sky-400/30 px-2 py-0.5 text-sky-400 transition-colors hover:border-sky-400/60 hover:text-sky-300"
            >
              Analyze My Strategy →
            </button>
          </div>
        ) : analyzerQuery.isLoading ? (
          <div className="text-faint animate-pulse py-3 text-center text-xs">
            Running scenario analysis...
          </div>
        ) : analyzerQuery.data?.recommendations &&
          analyzerQuery.data.recommendations.length > 0 ? (
          <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h4 className="text-primary text-sm font-semibold">
                  Strategy Analysis — {analyzerQuery.data.strategyLabel}
                </h4>
                <p className="text-label text-faint">
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
                className="text-caption text-faint hover:text-secondary"
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
                    <span className="shrink-0 font-bold text-sky-400">
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

            <p className="text-caption text-faint mt-3">
              Full engine assumptions used with only the stated change. 200
              simulations each.
            </p>
          </div>
        ) : analyzerQuery.data?.diagnosis === "healthy" ? (
          <div className="text-faint rounded-lg border border-green-500/20 bg-green-950/20 p-3 text-xs">
            Your strategy is well-optimized — no single parameter change
            produces a meaningful improvement (&gt;2pp). Consider broader
            changes like increasing guaranteed income or adjusting your
            timeline.
            <button
              onClick={() => setAnalyzerEnabled(false)}
              className="text-caption text-faint hover:text-secondary ml-2"
            >
              Dismiss
            </button>
          </div>
        ) : analyzerQuery.isError ? (
          <div className="text-faint rounded-lg border border-red-500/20 bg-red-950/20 p-3 text-xs">
            Analysis failed. Try again or adjust your inputs.
            <button
              onClick={() => setAnalyzerEnabled(false)}
              className="text-caption text-faint hover:text-secondary ml-2"
            >
              Dismiss
            </button>
          </div>
        ) : analyzerQuery.data ? (
          <div className="text-faint rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs">
            No parameter changes produce a meaningful improvement (&gt;2pp) for
            your current configuration. The biggest gains would come from
            changes outside strategy parameters (saving more, delaying
            retirement, increasing guaranteed income).
            <button
              onClick={() => setAnalyzerEnabled(false)}
              className="text-caption text-faint hover:text-secondary ml-2"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
