"use client";

import {
  SIMULATION_NOT_CONFIGURED_MESSAGE,
  type SimulationNotConfigured,
} from "@/lib/pure/simulation/monte-carlo";
import { strategySummary } from "@/lib/pure/strategy-summary";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import type { DollarBasis } from "@/lib/config/enum-values";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { StrategyGuideButton } from "@/components/cards/strategy-guide-panel";
import { trpc, type RouterOutputs } from "@/lib/trpc";
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
import { simulationRateTone } from "@/lib/config/simulation-tones";

const RATE_TONE_CLASS = {
  green: "text-green-400",
  amber: "text-yellow-400",
  red: "text-red-400",
} as const;

type StrategyResult = Extract<
  RouterOutputs["projection"]["computeStrategyComparison"],
  { strategies: unknown }
>["strategies"][number];

type AnalyzerInput = {
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
  /** The Simulation preset behind the Success and Stability columns. */
  presetLabel?: string;
  /** Why those columns are empty (the Simulation can't run), or null. */
  notConfigured?: SimulationNotConfigured | null;
  dollarMode: DollarBasis;
  onDollarModeChange: (mode: DollarBasis) => void;
  inflationRate: number;
  analyzerInput?: AnalyzerInput;
};

type ChartMetric = "retirementBalance" | "withdrawal";

export function WithdrawalComparisonCard({
  strategies,
  activeStrategy,
  presetLabel,
  notConfigured,
  dollarMode,
  onDollarModeChange,
  inflationRate,
  analyzerInput,
}: Props) {
  const [chartMetric, setChartMetric] =
    useState<ChartMetric>("retirementBalance");
  const [analyzerEnabled, setAnalyzerEnabled] = useState(false);

  // Analyzer query — only runs when user opts in
  const analyzerQuery = trpc.projection.analyzeStrategy.useQuery(
    analyzerInput ?? {},
    { enabled: analyzerEnabled && !!analyzerInput },
  );

  if (strategies.length === 0) return null;

  const deflator = flatDeflator(new Date().getFullYear(), inflationRate);
  const deflate = (value: number, year: number) =>
    dollarMode === "nominal" ? value : toTodaysDollars(value, year, deflator);

  // Build chart data: merge all strategies into year-indexed rows
  const chartData = (() => {
    const byYear = new Map<number, Record<string, number>>();
    for (const s of strategies) {
      for (const pt of s.yearByYear) {
        if (!byYear.has(pt.year)) byYear.set(pt.year, { year: pt.year });
        const raw =
          chartMetric === "retirementBalance"
            ? pt.retirementBalance
            : pt.withdrawal;
        byYear.get(pt.year)![s.strategy] = deflate(raw, pt.year);
      }
    }
    return Array.from(byYear.values()).sort(
      (a, b) => (a.year ?? 0) - (b.year ?? 0),
    );
  })();

  return (
    <Card
      title="Withdrawal Strategy Comparison"
      subtitle={`Comparing ${strategies.length} strategies from ${strategies[0]?.yearByYear[0]?.year ?? "retirement"} · ${notConfigured ? SIMULATION_NOT_CONFIGURED_MESSAGE[notConfigured] : "Success % via simulation"}`}
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
      {presetLabel && (
        <p className="text-caption text-faint mb-1">
          Success and stability use the {presetLabel} preset&apos;s returns,
          volatility and glide path — the preset chosen for the Simulation.
        </p>
      )}
      {/* Table */}
      {
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-faint border-b">
                <th className="py-1.5 pr-2 text-left font-medium">Strategy</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  Falls Short
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
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="What you spend in the first retirement year, Social Security included">
                    Spend yr 1
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="What you spend on average a year, Social Security included">
                    Spend avg
                  </span>
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  <span title="Withdrawn from the portfolio in the first retirement year — strategies with Social Security on top withdraw more than ones it comes out of">
                    Year 1
                  </span>
                </th>
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
                      {s.failureYear != null ? (
                        <span
                          title={
                            s.failureReason === "depleted"
                              ? "Retirement money runs out"
                              : s.failureReason === "penaltyGap"
                                ? "Money locked by early-withdrawal penalties"
                                : "Spending can't be fully funded"
                          }
                        >
                          {s.failureYear}
                        </span>
                      ) : (
                        <span className="text-green-400">Never</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.successRate !== null ? (
                        <span
                          className={
                            RATE_TONE_CLASS[simulationRateTone(s.successRate)]
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
                            RATE_TONE_CLASS[
                              simulationRateTone(s.spendingStabilityRate)
                            ]
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
                            RATE_TONE_CLASS[
                              simulationRateTone(s.budgetStabilityRate)
                            ]
                          }
                        >
                          {formatPercent(s.budgetStabilityRate)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).year1Spending,
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).avgSpending,
                      )}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).year1Withdrawal,
                      )}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).avgWithdrawal,
                      )}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).minWithdrawal,
                      )}
                    </td>
                    <td className="text-faint px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).maxWithdrawal,
                      )}
                    </td>
                    <td className="text-faint py-1.5 pl-2 text-right tabular-nums">
                      {formatCurrency(
                        strategySummary(s.yearByYear, deflate).legacy,
                      )}
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
              onClick={() => setChartMetric("retirementBalance")}
              className={`text-caption rounded px-2 py-0.5 ${chartMetric === "retirementBalance" ? "bg-blue-600 text-white" : "bg-surface-elevated text-faint"}`}
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
                dataKey="year"
                stroke={CHART_COLORS.wdComparisonAxis}
                tick={{ fontSize: CHART_FONT.tick }}
                label={{
                  value: "Year",
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
                labelFormatter={(year) => String(year)}
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
        ) : analyzerQuery.data && "notConfigured" in analyzerQuery.data ? (
          <div className="text-faint rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs">
            {
              SIMULATION_NOT_CONFIGURED_MESSAGE[
                analyzerQuery.data.notConfigured
              ]
            }
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
