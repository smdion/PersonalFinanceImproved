"use client";

/** Spending Stability chart — shows withdrawal as % of initial plan over time.
 *  Deterministic trajectory with 75% stability threshold line. */
import { formatPercent } from "@/lib/utils/format";
import type { EngineDecumulationYear } from "@/lib/calculators/types";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

export function SpendingStabilityChart({ s }: { s: ProjectionState }) {
  const { result, engineSettings } = s;

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

  const chartData = decYears
    .filter((_, i) => i % 2 === 0 || i === decYears.length - 1)
    .map((yr) => {
      const decIdx = yr.age - decYears[0]!.age;
      const inflationFactor = Math.pow(1 + inflationRate, decIdx);
      const baseline = year1Withdrawal * inflationFactor;
      const ratio = baseline > 0 ? yr.totalWithdrawal / baseline : 1;

      return {
        age: yr.age,
        year: yr.year,
        ratio: Math.round(ratio * 1000) / 10, // as percentage (e.g., 85.0)
        threshold: 75,
        withdrawal: yr.totalWithdrawal,
        baseline,
      };
    });

  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <h5 className="text-xs font-medium text-muted uppercase mb-2">
        Spending Stability
        <span className="text-[9px] text-faint font-normal ml-2 normal-case">
          Withdrawal as % of initial plan (inflation-adjusted)
        </span>
      </h5>
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
              const d = payload[0].payload as (typeof chartData)[0];
              return (
                <div className="bg-surface-primary border rounded-lg shadow-lg p-2 text-xs">
                  <div className="font-medium mb-1">
                    Age {d.age} · {d.year}
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Spending ratio:</span>
                    <span
                      className={
                        d.ratio >= 75
                          ? "text-green-600 font-medium"
                          : "text-red-500 font-medium"
                      }
                    >
                      {d.ratio.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Actual withdrawal:</span>
                    <span>
                      {formatPercent(d.withdrawal / d.baseline, 1)} of plan
                    </span>
                  </div>
                </div>
              );
            }}
          />
          {/* 75% stability threshold line */}
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
          {/* Area fill below the line for visual weight */}
          <Area
            type="monotone"
            dataKey="ratio"
            stroke="none"
            fill="var(--color-indigo-500, #6366f1)"
            fillOpacity={0.15}
          />
          {/* Main spending ratio line */}
          <Line
            type="monotone"
            dataKey="ratio"
            stroke="var(--color-indigo-500, #6366f1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
