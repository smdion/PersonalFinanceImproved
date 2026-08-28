"use client";

/** Spending Stability chart — shows withdrawal as % of baseline over time.
 *  Bar chart matching the Balance chart visual pattern.
 *  "strategy" view: bars show ratio vs year-1 withdrawal.
 *  "budget" view: bars show ratio vs retirement budget.
 *  MC fan bands + median line overlay when available. */
import {
  formatCurrency,
  formatPercent,
  compactCurrency,
} from "@/lib/utils/format";
import { DEFAULT_INFLATION_RATE } from "@/lib/constants";
import { safeDivide } from "@/lib/utils/math";
import type { EngineDecumulationYear } from "@/lib/calculators/types";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import {
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartControls } from "./chart-controls";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { CHART_COLORS } from "@/lib/utils/colors";
import type { ProjectionState } from "./projection-table-types";

export function SpendingStabilityChart({
  state,
  view,
}: {
  state: ProjectionState;
  view: "strategy" | "budget";
}) {
  const { result, engineSettings, mcStabilityBands, fanBandRange, deflate } =
    state;

  if (!result) return null;

  const years = result.projectionByYear;
  const decYears = years.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );

  if (decYears.length === 0) {
    return (
      <div className="bg-surface-sunken rounded-lg p-3">
        <h5 className="text-xs font-medium text-muted uppercase mb-2">
          Spending Stability
        </h5>
        <div className="h-[320px] flex items-center justify-center text-muted text-sm">
          No decumulation years to display — retirement hasn&apos;t started yet
          in this projection.
        </div>
      </div>
    );
  }

  const year1Withdrawal = decYears[0]!.totalWithdrawal;
  const inflationRate =
    engineSettings?.annualInflation != null
      ? parseFloat(engineSettings.annualInflation)
      : DEFAULT_INFLATION_RATE;

  const isStrategy = view === "strategy";
  const baselineLabel = isStrategy ? "Strategy" : "Budget";

  // monte-carlo.ts's own "vs strategy" KPI (Income Stability card) uses
  // each year's real, guardrail/raise-adjusted `targetWithdrawal` for any
  // strategy with usesPostRetirementRaise — NOT a flat CPI-inflated line
  // off year 1. This chart used to always use the flat line regardless,
  // which converges toward the "Budget" view for budget-based strategies
  // (Fixed, Forgo, G-K) since their year-1 spending IS the budget, making
  // "Strategy" and "Budget" look like near-duplicates. Mirroring the same
  // flag here keeps the chart honest about what "vs Strategy" means.
  const activeStrategy = (engineSettings?.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const usesPostRetirementRaise =
    WITHDRAWAL_STRATEGY_CONFIG[activeStrategy]?.usesPostRetirementRaise ?? true;

  const hasMcData = !!mcStabilityBands;
  const mcBandMap = isStrategy
    ? mcStabilityBands?.stratRatio
    : mcStabilityBands?.budgetRatio;
  const showMc = hasMcData && !!mcBandMap && fanBandRange !== "off";
  const { showBars } = state;

  // Fan band range — same selector as Balance chart
  const bandKeys =
    fanBandRange === "p5-p95"
      ? { lo: "p5" as const, hi: "p95" as const }
      : fanBandRange === "p10-p90"
        ? { lo: "p10" as const, hi: "p90" as const }
        : { lo: "p25" as const, hi: "p75" as const };

  const chartData = decYears
    .filter((_, i) => i % 2 === 0 || i === decYears.length - 1)
    .map((yr) => {
      const decIdx = yr.age - decYears[0]!.age;
      const inflationFactor = Math.pow(1 + inflationRate, decIdx);

      const baseline = isStrategy
        ? usesPostRetirementRaise
          ? yr.targetWithdrawal
          : year1Withdrawal * inflationFactor
        : yr.projectedExpenses;
      // Matches monte-carlo.ts's own convention for a zero baseline (e.g.
      // Social Security fully covers year-1 spending): 0%, not a misleading
      // 100% that would hide real spending variability in later years.
      // Ratio itself is deflate-agnostic (numerator/denominator are the
      // same year's nominal dollars, so any deflation factor cancels) —
      // only the DISPLAY dollar figures below need `deflate` applied, same
      // as every sibling chart (projection-chart.tsx, hero KPIs, MC
      // results) already does, so this chart stops silently showing
      // nominal/future dollars while the rest of the page respects the
      // Today's $ / Future $ toggle.
      const ratio = safeDivide(yr.totalWithdrawal, baseline, 0);

      const band = mcBandMap?.get(yr.age);

      // MC band data — match Balance chart's stacked area pattern
      const pct = (v: number) => Math.round(v * 1000) / 10;
      const datum: Record<string, number | undefined> = {
        age: yr.age,
        ratio: pct(ratio),
        withdrawal: Math.round(deflate(yr.totalWithdrawal, yr.year)),
        baseline: Math.round(deflate(baseline, yr.year)),
      };

      if (band) {
        datum.mc_p50 = pct(band.p50);

        // Always include all band keys (0 for unused) so Recharts
        // re-stacks correctly when switching band ranges.
        if (fanBandRange === "p5-p95") {
          datum.mc_base = pct(band.p5);
          datum.mc_5_10 = pct(band.p10 - band.p5);
          datum.mc_10_25 = pct(band.p25 - band.p10);
          datum.mc_25_75 = pct(band.p75 - band.p25);
          datum.mc_75_90 = pct(band.p90 - band.p75);
          datum.mc_90_95 = pct(band.p95 - band.p90);
        } else if (fanBandRange === "p10-p90") {
          datum.mc_base = pct(band.p10);
          datum.mc_5_10 = 0;
          datum.mc_10_25 = pct(band.p25 - band.p10);
          datum.mc_25_75 = pct(band.p75 - band.p25);
          datum.mc_75_90 = pct(band.p90 - band.p75);
          datum.mc_90_95 = 0;
        } else {
          datum.mc_base = pct(band.p25);
          datum.mc_5_10 = 0;
          datum.mc_10_25 = 0;
          datum.mc_25_75 = pct(band.p75 - band.p25);
          datum.mc_75_90 = 0;
          datum.mc_90_95 = 0;
        }

        // For tooltip
        datum.mc_lo = pct(band[bandKeys.lo]);
        datum.mc_hi = pct(band[bandKeys.hi]);
      }

      return datum;
    });

  // Year-1 baseline for left axis dollar conversion (100% = this amount) —
  // deflated at decYears[0]'s year so this label matches the Today's $ /
  // Future $ toggle like the rest of the chart, not raw nominal dollars.
  const year1Baseline = deflate(
    isStrategy
      ? usesPostRetirementRaise
        ? decYears[0]!.targetWithdrawal
        : year1Withdrawal
      : decYears[0]!.projectedExpenses,
    decYears[0]!.year,
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-start justify-between mb-2 gap-2">
        <h5 className="text-xs font-medium text-muted uppercase">
          <span className="text-micro font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded mr-1.5 normal-case">
            %
          </span>
          Spending Stability — vs {baselineLabel}
          <span className="text-micro text-faint font-normal ml-2 normal-case">
            Withdrawal as % of{" "}
            {isStrategy
              ? usesPostRetirementRaise
                ? "the strategy's own year-by-year target"
                : "year-1 plan"
              : "retirement budget"}{" "}
            (inflation-adjusted)
          </span>
        </h5>
        <ChartControls state={state} />
      </div>
      {/* Always-visible explainer, not buried in a HelpTip — the flat-vs-
          drifting contrast between these two views reads as a bug at a
          glance without it. See PLAN-... UI/UX consultation for why this
          stays two separate views instead of one overlaid chart. */}
      <div className="text-micro text-faint mb-2">
        {isStrategy
          ? "Strategy bars stay near 100% by design — they compare spending to the strategy's own year-by-year target. They only dip when something (an RMD, a shortfall) forces spending away from that target."
          : "Budget bars can drift — they compare spending to your fixed, inflation-only starting budget, which doesn't know about guardrail raises or cuts. Drift here is a real signal, not an error."}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="age"
            tick={{ fontSize: CHART_FONT.tick, fill: "var(--text-faint)" }}
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: CHART_FONT.tiny, fill: "var(--text-faint)" }}
            tickFormatter={(v: number) => {
              const dollars = (v / 100) * year1Baseline;
              return compactCurrency(dollars);
            }}
            domain={[
              0,
              (max: number) => Math.max(150, Math.ceil(max / 10) * 10),
            ]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: CHART_FONT.tick, fill: "var(--text-faint)" }}
            tickFormatter={(v: number) => formatPercent(v / 100)}
            domain={[
              0,
              (max: number) => Math.max(150, Math.ceil(max / 10) * 10),
            ]}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as Record<
                string,
                number | undefined
              >;
              const ratio = d.ratio ?? 0;
              return (
                <div className="bg-surface-primary border rounded-lg shadow-lg p-2 text-xs">
                  <div className="font-medium mb-1">Age {d.age}</div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">vs {baselineLabel}:</span>
                    <span
                      className={
                        ratio >= 75
                          ? "text-blue-400 font-medium"
                          : "text-red-500 font-medium"
                      }
                    >
                      {formatPercent(ratio / 100, 1)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Withdrawal:</span>
                    <span>{formatCurrency(d.withdrawal ?? 0)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Plan ({baselineLabel}):</span>
                    <span className="text-faint">
                      {formatCurrency(d.baseline ?? 0)}
                    </span>
                  </div>
                  {d.mc_p50 !== undefined && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Sim. median:</span>
                      <span className="text-purple-400">
                        {formatPercent(d.mc_p50 / 100, 1)}
                      </span>
                    </div>
                  )}
                  {d.mc_lo !== undefined && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Confidence band:</span>
                      <span className="text-faint">
                        {formatPercent(d.mc_lo / 100, 1)} –{" "}
                        {formatPercent(d.mc_hi! / 100, 1)}
                      </span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: CHART_FONT.legend, paddingTop: 8 }}
          />

          {/* 75% stability threshold */}
          <ReferenceLine
            yAxisId="left"
            y={75}
            stroke="var(--text-red-500, #ef4444)"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: "75% Floor",
              position: "right",
              fill: "var(--text-red-500, #ef4444)",
              fontSize: CHART_FONT.tiny,
            }}
          />
          {/* 100% baseline reference */}
          <ReferenceLine
            yAxisId="left"
            y={100}
            stroke="var(--text-faint)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />

          {/* Invisible line bound to right axis to force percentage axis to render */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="ratio"
            stroke="transparent"
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />

          {/* MC fan bands — always render all 6 layers (unused ones have height 0) */}
          {showMc && (
            <>
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_base"
                stackId="mc"
                fill="transparent"
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_5_10"
                stackId="mc"
                fill={CHART_COLORS.mcBandOuter}
                fillOpacity={0.4}
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_10_25"
                stackId="mc"
                fill={CHART_COLORS.mcBandInner}
                fillOpacity={0.35}
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_25_75"
                stackId="mc"
                name="Confidence band"
                fill={CHART_COLORS.mcBandMiddle}
                fillOpacity={0.2}
                stroke="none"
                isAnimationActive={false}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_75_90"
                stackId="mc"
                fill={CHART_COLORS.mcBandInner}
                fillOpacity={0.35}
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mc_90_95"
                stackId="mc"
                fill={CHART_COLORS.mcBandOuter}
                fillOpacity={0.4}
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
            </>
          )}

          {/* Deterministic bars — same style as Balance chart */}
          {showBars && (
            <Bar
              yAxisId="left"
              dataKey="ratio"
              stackId="det"
              name={`vs ${baselineLabel}`}
              fill={CHART_COLORS.spendingRatioBar}
              fillOpacity={0.85}
              isAnimationActive={false}
              radius={[2, 2, 0, 0]}
            />
          )}

          {/* MC median line — same as Balance chart */}
          {showMc && (
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="mc_p50"
              name="Sim. median"
              stroke={CHART_COLORS.mcMedian}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
