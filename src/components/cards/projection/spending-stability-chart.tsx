"use client";

/** Spending Stability chart — shows withdrawal as % of baseline over time.
 *  Bar chart matching the Balance chart visual pattern.
 *  "strategy" view: bars show ratio vs year-1 withdrawal.
 *  "budget" view: bars show ratio vs retirement budget.
 *  MC fan bands + median line overlay when available. */
import type { EngineDecumulationYear } from "@/lib/calculators/types";
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
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

export function SpendingStabilityChart({
  s,
  view,
}: {
  s: ProjectionState;
  view: "strategy" | "budget";
}) {
  const {
    result,
    engineSettings,
    annualExpenses,
    decumulationExpenses,
    mcStabilityBands,
    fanBandRange,
  } = s;

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
  const inflationRate = engineSettings?.annualInflation
    ? parseFloat(engineSettings.annualInflation)
    : 0.03;

  // Budget baseline
  const retirementAge = engineSettings?.retirementAge ?? 65;
  const currentAge = decYears[0]!.age;
  const yearsToRetirement = Math.max(0, retirementAge - currentAge);
  const budgetToday = decumulationExpenses ?? annualExpenses;
  const budgetAtRetirement =
    budgetToday * Math.pow(1 + inflationRate, yearsToRetirement);

  const isStrategy = view === "strategy";
  const baselineLabel = isStrategy ? "Strategy" : "Budget";

  const hasMcData = !!mcStabilityBands;
  const mcBandMap = isStrategy
    ? mcStabilityBands?.stratRatio
    : mcStabilityBands?.budgetRatio;
  const showMc = hasMcData && !!mcBandMap && fanBandRange !== "off";
  const { showBars } = s;

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
        ? year1Withdrawal * inflationFactor
        : budgetAtRetirement * inflationFactor;
      const ratio = baseline > 0 ? yr.totalWithdrawal / baseline : 1;

      const band = mcBandMap?.get(yr.age);

      // MC band data — match Balance chart's stacked area pattern
      const pct = (v: number) => Math.round(v * 1000) / 10;
      const datum: Record<string, number | undefined> = {
        age: yr.age,
        ratio: pct(ratio),
      };

      if (band) {
        datum.mc_p50 = pct(band.p50);

        if (fanBandRange === "p5-p95") {
          datum.mc_base = pct(band.p5);
          datum.mc_5_10 = pct(band.p10 - band.p5);
          datum.mc_10_25 = pct(band.p25 - band.p10);
          datum.mc_25_75 = pct(band.p75 - band.p25);
          datum.mc_75_90 = pct(band.p90 - band.p75);
          datum.mc_90_95 = pct(band.p95 - band.p90);
        } else if (fanBandRange === "p10-p90") {
          datum.mc_base = pct(band.p10);
          datum.mc_10_25 = pct(band.p25 - band.p10);
          datum.mc_25_75 = pct(band.p75 - band.p25);
          datum.mc_75_90 = pct(band.p90 - band.p75);
        } else {
          datum.mc_base = pct(band.p25);
          datum.mc_25_75 = pct(band.p75 - band.p25);
        }

        // For tooltip
        datum.mc_lo = pct(band[bandKeys.lo]);
        datum.mc_hi = pct(band[bandKeys.hi]);
      }

      return datum;
    });

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <div className="flex items-start justify-between mb-2 gap-2">
        <h5 className="text-xs font-medium text-muted uppercase">
          Spending Stability — vs {baselineLabel}
          <span className="text-[9px] text-faint font-normal ml-2 normal-case">
            Withdrawal as % of{" "}
            {isStrategy ? "year-1 plan" : "retirement budget"}{" "}
            (inflation-adjusted)
          </span>
        </h5>
        <ChartControls s={s} />
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 10, fill: "var(--text-faint)" }}
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--text-faint)" }}
            tickFormatter={(v: number) => `${v}%`}
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
                      {ratio.toFixed(1)}%
                    </span>
                  </div>
                  {d.mc_p50 !== undefined && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Sim. median:</span>
                      <span className="text-purple-400">
                        {d.mc_p50.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {d.mc_lo !== undefined && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Confidence band:</span>
                      <span className="text-faint">
                        {d.mc_lo.toFixed(1)}% – {d.mc_hi!.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />

          {/* 75% stability threshold */}
          <ReferenceLine
            y={75}
            stroke="var(--text-red-500, #ef4444)"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: "75% Floor",
              position: "right",
              fill: "var(--text-red-500, #ef4444)",
              fontSize: 9,
            }}
          />
          {/* 100% baseline reference */}
          <ReferenceLine
            y={100}
            stroke="var(--text-faint)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />

          {/* MC fan bands — same colors/pattern as Balance chart */}
          {showMc && (
            <>
              <Area
                type="monotone"
                dataKey="mc_base"
                stackId="mc"
                fill="transparent"
                stroke="none"
                isAnimationActive={false}
                legendType="none"
              />
              {fanBandRange === "p5-p95" && (
                <Area
                  type="monotone"
                  dataKey="mc_5_10"
                  stackId="mc"
                  fill="#ede9fe"
                  fillOpacity={0.4}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
              {fanBandRange !== "p25-p75" && (
                <Area
                  type="monotone"
                  dataKey="mc_10_25"
                  stackId="mc"
                  fill="#c4b5fd"
                  fillOpacity={0.35}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
              <Area
                type="monotone"
                dataKey="mc_25_75"
                stackId="mc"
                name="Confidence band"
                fill="#8b5cf6"
                fillOpacity={0.2}
                stroke="none"
                isAnimationActive={false}
              />
              {fanBandRange !== "p25-p75" && (
                <Area
                  type="monotone"
                  dataKey="mc_75_90"
                  stackId="mc"
                  fill="#c4b5fd"
                  fillOpacity={0.35}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
              {fanBandRange === "p5-p95" && (
                <Area
                  type="monotone"
                  dataKey="mc_90_95"
                  stackId="mc"
                  fill="#ede9fe"
                  fillOpacity={0.4}
                  stroke="none"
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
            </>
          )}

          {/* Deterministic bars — same style as Balance chart */}
          {showBars && (
            <Bar
              dataKey="ratio"
              stackId="det"
              name={`vs ${baselineLabel}`}
              fill="#3b82f6"
              fillOpacity={0.85}
              isAnimationActive={false}
              radius={[2, 2, 0, 0]}
            />
          )}

          {/* MC median line — same as Balance chart */}
          {showMc && (
            <Line
              type="monotone"
              dataKey="mc_p50"
              name="Sim. median"
              stroke="#7c3aed"
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
