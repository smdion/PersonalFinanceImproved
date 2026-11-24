/** The Withdrawal Strategy Comparison's chart and its metric toggle. */
import { formatCurrency, compactCurrency } from "@/lib/utils/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { ChartFrame } from "@/components/charts/chart-frame";
import { strategyLinesSummary } from "./withdrawal-comparison.summary";
import { STRATEGY_COMPARISON_COLORS, CHART_COLORS } from "@/lib/utils/colors";
import type { ChartMetric } from "./withdrawal-comparison.model";

type StrategyComparisonChartProps = {
  chartMetric: ChartMetric;
  setChartMetric: (metric: ChartMetric) => void;
  chartData: Record<string, number>[];
  strategies: readonly { strategy: string; shortLabel: string }[];
  activeStrategy: string | null;
};
export function StrategyComparisonChart({
  chartMetric,
  setChartMetric,
  chartData,
  strategies,
  activeStrategy,
}: StrategyComparisonChartProps) {
  return (
    <>
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
          <ChartFrame
            summary={strategyLinesSummary(chartData, strategies, chartMetric)}
            height={300}
          >
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={CHART_COLORS.withdrawalComparisonGrid}
              />
              <XAxis
                dataKey="year"
                stroke={CHART_COLORS.withdrawalComparisonAxis}
                tick={{ fontSize: CHART_FONT.tick }}
                label={{
                  value: "Year",
                  position: "insideBottom",
                  offset: -5,
                  fontSize: CHART_FONT.tick,
                  fill: CHART_COLORS.withdrawalComparisonAxis,
                }}
              />
              <YAxis
                stroke={CHART_COLORS.withdrawalComparisonAxis}
                tick={{ fontSize: CHART_FONT.tick }}
                tickFormatter={(v: number) => compactCurrency(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_COLORS.withdrawalComparisonTooltipBg,
                  border: `1px solid ${CHART_COLORS.withdrawalComparisonGrid}`,
                  borderRadius: "6px",
                  fontSize: CHART_FONT.tooltip,
                }}
                labelStyle={{ color: CHART_COLORS.withdrawalComparisonAxis }}
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
          </ChartFrame>
        </div>
      }
    </>
  );
}
