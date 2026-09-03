"use client";

import { useEffect, useRef } from "react";

/** Yearly Income Stability chart — shows withdrawal as % of baseline over
 *  time, one year at a time (the per-year counterpart to the Lifetime
 *  Income Stability KPI ring, which instead measures whether that ratio
 *  ever breached the floor across the WHOLE retirement horizon).
 *  Bar chart matching the Balance chart visual pattern.
 *  "strategy" view: bars show ratio vs that year's own guardrail target.
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
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { CHART_COLORS, chartLinePalette } from "@/lib/utils/colors";
import { useTheme } from "@/lib/hooks/use-theme";
import type { ProjectionState } from "./projection-table-types";

export function SpendingStabilityChart({
  state,
  view,
}: {
  state: ProjectionState;
  view: "strategy" | "budget";
}) {
  const c = {
    ...CHART_COLORS,
    ...chartLinePalette(useTheme().resolvedTheme === "dark"),
  };
  const {
    result,
    engineSettings,
    mcStabilityBands,
    fanBandRange,
    deflate,
    showStabilityBars,
    setShowStabilityBars,
  } = state;
  // Smart DEFAULT (hidden for GK/Forgo/etc. — flat/uneventful without real
  // volatility), applied ONCE via the shared showStabilityBars toggle (the
  // same BASELINE On/Off pill the Balance chart uses, contextually
  // rewired in index.tsx's toolbar) — never a permanent hide, and never
  // re-applied after the user's own first interaction, so it can't fight
  // a manual toggle back on (user feedback, 2026-08-28: a separate
  // "Show anyway" link was confusing because the real BASELINE toggle
  // appeared to do nothing on this chart).
  const reactsToVolatility =
    WITHDRAWAL_STRATEGY_CONFIG[
      (engineSettings?.withdrawalStrategy ?? "fixed") as WithdrawalStrategyType
    ]?.reactsToVolatility ?? false;
  const appliedSmartDefault = useRef(false);
  useEffect(() => {
    if (appliedSmartDefault.current) return;
    if (reactsToVolatility) {
      appliedSmartDefault.current = true;
      setShowStabilityBars(false);
    }
  }, [reactsToVolatility, setShowStabilityBars]);

  if (!result) return null;

  const years = result.projectionByYear;
  const decYears = years.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );

  if (decYears.length === 0) {
    return (
      <div className="bg-surface-sunken rounded-lg p-3">
        <h5 className="text-muted mb-2 text-xs font-medium uppercase">
          Yearly Income Stability
        </h5>
        <div className="text-muted flex h-[320px] items-center justify-center text-sm">
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

  // monte-carlo.ts's own "vs strategy" KPI (Lifetime Income Stability card) uses
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
  // reactsToVolatility computed earlier (before the early returns, for the
  // smart-default effect). Bars now read the shared showStabilityBars
  // toggle directly -- no re-gating here, so the BASELINE pill is the one
  // real control (see index.tsx's toolbar / use-projection-form-state.ts).
  const showBars = showStabilityBars;

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
        : yr.budgetOnlyExpenses;
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
        // % of sims that breached the 75% floor THIS year — visible even
        // when percentiles are degenerate (e.g. only 8% of trials breach,
        // so p25/p50/p75 all stay flat at 100% and hide it). This is what
        // actually answers the KPI warning's "see which years" (2026-08-28
        // live-user finding: the chart didn't deliver on that promise).
        datum.mc_breach = pct(band.breachRate ?? 0);

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
      : decYears[0]!.budgetOnlyExpenses,
    decYears[0]!.year,
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h5 className="text-muted text-xs font-medium uppercase">
          <span className="text-micro mr-1.5 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-600 normal-case">
            %
          </span>
          Yearly Income Stability · vs {baselineLabel}
          <span className="text-micro text-faint ml-2 font-normal normal-case">
            Withdrawal as % of{" "}
            {isStrategy
              ? usesPostRetirementRaise
                ? "the strategy's own year-by-year target"
                : "year-1 plan"
              : "retirement budget"}{" "}
            (inflation-adjusted)
          </span>
        </h5>
      </div>
      {/* Always-visible explainer, not buried in a HelpTip — the flat-vs-
          drifting contrast between these two views reads as a bug at a
          glance without it. See PLAN-... UI/UX consultation for why this
          stays two separate views instead of one overlaid chart. */}
      <div className="text-micro text-faint mb-2">
        {isStrategy
          ? "Strategy bars stay near 100% by design — they compare spending to the strategy's own year-by-year target. They only dip when something (an RMD, a shortfall) forces spending away from that target."
          : "Budget bars can drift — they compare spending to your fixed, inflation-only starting budget, which doesn't know about guardrail raises or cuts. Drift here is a real signal, not an error."}
        {reactsToVolatility && !showBars && (
          <>
            {" "}
            {(WITHDRAWAL_STRATEGY_CONFIG[activeStrategy]?.label ??
              activeStrategy) + "’s"}{" "}
            own guardrail mechanism needs real return volatility to trigger, so
            the deterministic bars are hidden here by default (they&apos;d just
            be a flat, uneventful line) — look at the Confidence Band below for
            where the real variation actually shows up, or switch BASELINE to On
            above to see them anyway.
          </>
        )}
        {showMc && (
          <>
            {" "}
            The orange <strong>Breached floor</strong> line is the % of
            simulated futures whose spending fell below the 75% Floor THAT year
            — it can spike even in years where the Confidence Band above looks
            flat, since a deviation affecting only a small slice of simulations
            doesn&apos;t move the middle percentiles.
          </>
        )}
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
                <div className="bg-surface-primary rounded-lg border p-2 text-xs shadow-lg">
                  <div className="mb-1 font-medium">Age {d.age}</div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">vs {baselineLabel}:</span>
                    <span
                      className={
                        ratio >= 75
                          ? "font-medium text-blue-400"
                          : "font-medium text-red-500"
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
                      <span className="text-purple-600">
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
                  {d.mc_breach !== undefined && d.mc_breach > 0 && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Breached floor:</span>
                      <span className="font-medium text-orange-500">
                        {formatPercent(d.mc_breach / 100, 1)} of sims
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
            stroke={CHART_COLORS.stabilityFloorLine}
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: "75% Floor",
              position: "right",
              fill: CHART_COLORS.stabilityFloorLine,
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
              stroke={c.mcMedian}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
          )}

          {/* % of sims that breached the floor THIS year — independent of
              the confidence-band width, so a real but rare/concentrated
              deviation shows up even when p5-p95 (or narrower) leaves the
              band itself looking flat. Right axis (0-100%, shares the
              hidden forcing line's scale). */}
          {showMc && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="mc_breach"
              name="Breached floor"
              stroke={CHART_COLORS.perfBrokerage}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
