"use client";

/** Balance projection chart — stacked bar (deterministic) + MC fan bands + median line. */
import { taxTypeLabel, categoryChartHex } from "@/lib/utils/colors";
import { formatCurrency } from "@/lib/utils/format";
import type { EngineYearProjection } from "@/lib/calculators/types";
import {
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  getAccountSegments,
  getSegmentBalance,
} from "@/lib/config/account-types";
import type { useProjectionState } from "./use-projection-state";

type ProjectionState = ReturnType<typeof useProjectionState>;

export function ProjectionChartSkeleton() {
  return (
    <div className="bg-surface-sunken rounded-lg p-3">
      <h5 className="text-xs font-medium text-muted uppercase mb-2">
        Balance Projection
        <span className="text-[9px] text-purple-400 animate-pulse ml-2 normal-case font-normal">
          Running simulation...
        </span>
      </h5>
      <div className="h-[320px] relative overflow-hidden">
        <div className="absolute inset-0 flex items-end gap-1.5 px-8 pb-8 pt-4">
          {[
            18, 24, 30, 38, 46, 55, 62, 70, 78, 84, 88, 92, 95, 90, 85, 80, 74,
            68, 60, 52, 44, 36, 28, 20,
          ].map((h, i) => (
            <div
              key={h}
              className="flex-1 rounded-t bg-surface-strong animate-pulse"
              style={{
                height: `${h}%`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-faint bg-surface-sunken/80 px-3 py-1.5 rounded-full animate-pulse">
            Simulating 1,000 scenarios...
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectionChart({ s }: { s: ProjectionState }) {
  const {
    result,
    engineSettings,
    isPersonFiltered,
    personFilterName,
    getPersonYearTotals,
    deflate,
    mcBandsByYear,
    mcPrefetchQuery,
    mcIsPrefetch,
    visibleColumns,
    columnLabel,
    balanceView,
    fanBandRange,
  } = s;

  if (!result) return null;

  // Bars always show standalone deterministic projection.
  // MC fan bands + median line overlay on top via mcBandsByYear.
  const years = result.projectionByYear;
  const retAge = engineSettings!.retirementAge;
  const retIdx = years.findIndex((y) => y.age === retAge);
  const filtered = years.filter((_, i) => i % 2 === 0 || i === retIdx);

  // Hex colors for Recharts
  const TAX_HEX: Record<string, string> = {
    preTax: "#3b82f6",
    taxFree: "#8b5cf6",
    hsa: "#10b981",
    afterTax: "#f97316",
  };
  const TAX_KEYS = (["preTax", "taxFree", "hsa", "afterTax"] as const).filter(
    (t) => visibleColumns.balanceTaxTypes.has(t),
  );

  // Account-level chart segments
  const ACCT_SEGMENTS = getAccountSegments()
    .map((seg) => ({
      key: seg.key,
      hex: categoryChartHex(seg.category, seg.subKey === "roth"),
      label: columnLabel[seg.key] ?? seg.label,
      get: (yr: EngineYearProjection) =>
        getSegmentBalance(yr.balanceByAccount, seg),
    }))
    .filter((seg) => visibleColumns.balanceAccts.has(seg.key));

  // Build chart data
  const chartData = filtered.map((yr) => {
    const pt = getPersonYearTotals(yr);
    const datum: Record<string, number | string> = {
      age: yr.age,
      year: yr.year,
    };

    if (balanceView === "taxType") {
      for (const key of TAX_KEYS) {
        const val = pt ? pt.byTaxType[key] : yr.balanceByTaxType[key];
        datum[key] = Math.max(0, deflate(val, yr.year));
      }
    } else {
      for (const seg of ACCT_SEGMENTS) {
        const val = pt ? (pt.byAccount[seg.key] ?? 0) : seg.get(yr);
        datum[seg.key] = Math.max(0, deflate(val, yr.year));
      }
    }

    // MC percentile band areas
    const band = mcBandsByYear?.get(yr.year);
    if (band) {
      const dp5 = deflate(band.p5, yr.year);
      const dp10 = deflate(band.p10, yr.year);
      const dp25 = deflate(band.p25, yr.year);
      const dp50 = deflate(band.p50, yr.year);
      const dp75 = deflate(band.p75, yr.year);
      const dp90 = deflate(band.p90, yr.year);
      const dp95 = deflate(band.p95, yr.year);
      datum.mc_dp25 = dp25;
      datum.mc_dp75 = dp75;
      datum.mc_p50 = dp50;
      if (fanBandRange === "p5-p95") {
        datum.mc_base = dp5;
        datum.mc_5_10 = dp10 - dp5;
        datum.mc_10_25 = dp25 - dp10;
        datum.mc_25_75 = dp75 - dp25;
        datum.mc_75_90 = dp90 - dp75;
        datum.mc_90_95 = dp95 - dp90;
      } else if (fanBandRange === "p10-p90") {
        datum.mc_base = dp10;
        datum.mc_10_25 = dp25 - dp10;
        datum.mc_25_75 = dp75 - dp25;
        datum.mc_75_90 = dp90 - dp75;
      } else {
        datum.mc_base = dp25;
        datum.mc_25_75 = dp75 - dp25;
      }
    }

    return datum;
  });

  const segmentKeys =
    balanceView === "taxType"
      ? TAX_KEYS.map((k) => ({
          key: k,
          hex: TAX_HEX[k],
          label: taxTypeLabel(k),
        }))
      : ACCT_SEGMENTS.map((s) => ({
          key: s.key,
          hex: s.hex,
          label: s.label,
        }));

  const hasMc = mcBandsByYear != null;

  return (
    <div className="bg-surface-sunken rounded-lg p-3 chart-fade-in">
      <h5 className="text-xs font-medium text-muted uppercase mb-2">
        Balance Projection
        {isPersonFiltered && (
          <span className="text-[10px] text-faint font-normal normal-case ml-2">
            {personFilterName}
          </span>
        )}
        {!mcBandsByYear && mcPrefetchQuery.isFetching && (
          <span className="text-[9px] text-purple-400 animate-pulse ml-2 normal-case font-normal">
            MC loading...
          </span>
        )}
        {hasMc && mcIsPrefetch && (
          <span className="text-[9px] text-purple-400 ml-2 normal-case font-normal">
            MC preview
          </span>
        )}
      </h5>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 15, left: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="age"
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickLine={false}
              axisLine={{ stroke: "#d1d5db" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                v >= 1_000_000
                  ? `$${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000
                    ? `$${(v / 1_000).toFixed(0)}K`
                    : `$${v}`
              }
              width={55}
            />
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                const totalBal = segmentKeys.reduce(
                  (s, k) => s + (Number(d[k.key]) || 0),
                  0,
                );
                return (
                  <div className="bg-surface-primary text-primary text-xs rounded-md px-3 py-2 shadow-lg max-w-xs">
                    <div className="font-medium mb-1">
                      Age {d.age} · {d.year}
                    </div>
                    {segmentKeys
                      .filter((k) => (Number(d[k.key]) || 0) > 0)
                      .map((k) => (
                        <div key={k.key} className="flex justify-between gap-4">
                          <span className="flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded"
                              style={{ backgroundColor: k.hex }}
                            />
                            {k.label}
                          </span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d[k.key]))}
                          </span>
                        </div>
                      ))}
                    <div className="border-t mt-1 pt-1 flex justify-between font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {formatCurrency(totalBal)}
                      </span>
                    </div>
                    {hasMc && d.mc_p50 != null && (
                      <div className="border-t mt-1 pt-1">
                        <div className="flex justify-between text-purple-300">
                          <span>MC Median</span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d.mc_p50))}
                          </span>
                        </div>
                        <div className="flex justify-between text-purple-400/70">
                          <span>p25–p75</span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d.mc_dp25))}
                            {" –"}
                            {formatCurrency(Number(d.mc_dp75))}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* MC percentile fan — behind bars */}
            {hasMc && (
              <>
                <Area
                  type="monotone"
                  dataKey="mc_base"
                  stackId="mc"
                  fill="transparent"
                  stroke="none"
                  isAnimationActive={false}
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
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="mc_25_75"
                  stackId="mc"
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
                  />
                )}
              </>
            )}

            {/* Stacked bars — deterministic breakdown */}
            {segmentKeys.map((seg, i) => (
              <Bar
                key={seg.key}
                dataKey={seg.key}
                stackId="det"
                fill={seg.hex}
                fillOpacity={0.85}
                isAnimationActive={false}
                radius={i === segmentKeys.length - 1 ? [2, 2, 0, 0] : undefined}
              />
            ))}

            {/* MC median line */}
            {hasMc && (
              <Line
                type="monotone"
                dataKey="mc_p50"
                stroke="#7c3aed"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                isAnimationActive={false}
              />
            )}

            {/* Retirement age reference line */}
            {(() => {
              const retDataIdx = chartData.findIndex(
                (d) => Number(d.age) === retAge,
              );
              if (retDataIdx < 0) return null;
              return (
                <Line
                  type="monotone"
                  dataKey={() => undefined}
                  stroke="transparent"
                  dot={false}
                  isAnimationActive={false}
                  label={false}
                />
              );
            })()}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-faint flex-wrap">
        {segmentKeys.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded"
              style={{ backgroundColor: seg.hex }}
            />
            {""}
            {seg.label}
          </span>
        ))}
        {hasMc && (
          <>
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: "#7c3aed" }}
              />
              {""}
              MC p50
              {mcIsPrefetch && (
                <span className="text-faint ml-0.5">(preview)</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-1.5 rounded"
                style={{
                  backgroundColor: "#8b5cf6",
                  opacity: 0.3,
                }}
              />
              {""}
              p25–p75
            </span>
            {fanBandRange !== "p25-p75" && (
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-1.5 rounded"
                  style={{
                    backgroundColor:
                      fanBandRange === "p5-p95" ? "#ede9fe" : "#c4b5fd",
                    opacity: fanBandRange === "p5-p95" ? 0.6 : 0.5,
                  }}
                />
                {""}
                {fanBandRange === "p10-p90" ? "p10–p90" : "p5–p95"}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
