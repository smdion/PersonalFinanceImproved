"use client";

/** Balance projection chart — stacked bar (deterministic) + confidence bands + median line. */
import {
  taxTypeLabel,
  categoryChartHex,
  TAX_PIE_COLORS,
  CHART_COLORS,
} from "@/lib/utils/colors";
import { ChartControls } from "./chart-controls";
import {
  formatCurrency,
  compactCurrency,
  formatPercent,
} from "@/lib/utils/format";
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
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  getAccountSegments,
  getSegmentBalance,
} from "@/lib/config/account-types";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import type { ProjectionState } from "./projection-table-types";

// Skeleton lives in its own file so the parent (cards/projection/index.tsx)
// can render it without pulling recharts in via this module's import graph.
export { ProjectionChartSkeleton } from "./projection-chart-skeleton";

// Recognized sporadic per-strategy spending-adjustment events (R45 Step 5 +
// follow-up) — shared between the early chart-data pinning pass and the
// later marker-style/tooltip build, so the two can't drift on which action
// strings are "an event worth marking" vs. background noise. RMD-Based and
// Spending-Decline fire an action every year (not an event) and are
// deliberately excluded.
const STRATEGY_EVENT_KEYS = [
  "increase",
  "decrease",
  "skip_inflation",
  "ceiling_applied",
  "floor_applied",
] as const;

export function ProjectionChart({ state }: { state: ProjectionState }) {
  // Check via `state.result` before destructuring — result truthy always
  // implies engineSettings defined (see use-projection-derived.ts), but that
  // pairing only survives TS narrowing through the object, not through
  // pre-destructured locals.
  if (!state.result) return null;

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
  } = state;

  // Bars always show standalone deterministic projection.
  // MC fan bands + median line overlay on top via mcBandsByYear.
  const years = result.projectionByYear;
  const retAge = engineSettings.retirementAge;
  const ssStartAge = engineSettings.ssStartAge;
  // Detect RMD start age from first decumulation year with rmdAmount > 0
  const rmdStartAge =
    years.find((y) => y.phase === "decumulation" && y.rmdAmount > 0)?.age ??
    null;
  const retIdx = years.findIndex((y) => y.age === retAge);
  // Also pin the SS and RMD start years so milestone reference lines always
  // appear, even when those ages fall on an odd-indexed (normally skipped) year.
  const ssIdx = years.findIndex((y) => y.age === ssStartAge);
  const rmdIdx =
    rmdStartAge != null ? years.findIndex((y) => y.age === rmdStartAge) : -1;
  // R45 Step 5: Guyton-Klinger guardrail events (data already computed and
  // shown in the table-row tooltip — see projection-table-decum-row.tsx —
  // just not previously marked on the chart). Pin every triggering year the
  // same way SS/RMD start ages are pinned, or a guardrail event on an
  // odd-indexed year would silently vanish from the downsampled chart data.
  const guardrailIdxs = new Set(
    years
      .map((y, i) => ({ y, i }))
      .filter(
        ({ y }) =>
          y.phase === "decumulation" &&
          y.strategyAction != null &&
          (STRATEGY_EVENT_KEYS as readonly string[]).includes(y.strategyAction),
      )
      .map(({ i }) => i),
  );
  const filtered = years.filter(
    (_, i) =>
      i % 2 === 0 ||
      i === retIdx ||
      i === ssIdx ||
      (rmdIdx !== -1 && i === rmdIdx) ||
      guardrailIdxs.has(i),
  );

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

    // Milestone event annotations (decumulation only)
    if (yr.phase === "decumulation") {
      datum._ssStart = yr.age === ssStartAge && yr.ssIncome > 0 ? 1 : 0;
      datum._rmdStart =
        rmdStartAge != null && yr.age === rmdStartAge && yr.rmdAmount > 0
          ? 1
          : 0;
      datum._ssIncome = yr.ssIncome;
      datum._rmdAmount = yr.rmdAmount;
      datum._totalWithdrawal = yr.totalWithdrawal;
      // Guardrail event (R45 Step 5 follow-up) — the ReferenceLine markers
      // added a visual "▲ raise" flag on the chart but the hover tooltip
      // never carried the underlying detail, so hovering that exact year
      // showed nothing about why it was marked. Threaded through the same
      // way SS/RMD milestones are.
      datum._strategyAction = yr.strategyAction ?? "";
    }

    return datum;
  });

  const segmentKeys =
    balanceView === "taxType"
      ? TAX_KEYS.map((k) => ({
          key: k,
          hex: TAX_PIE_COLORS[k],
          label: taxTypeLabel(k),
        }))
      : ACCT_SEGMENTS.map((s) => ({
          key: s.key,
          hex: s.hex,
          label: s.label,
        }));

  const hasMcData = mcBandsByYear != null;
  const showMc = hasMcData && fanBandRange !== "off";
  const { showBars } = state;
  // Keep hasMc for backward compat in data building (always build MC data points)
  const hasMc = hasMcData;

  // R45 Step 5 + follow-up: per-strategy spending-adjustment event markers,
  // one per triggering year. Covers every strategy with a real, SPORADIC
  // action worth flagging — Guyton-Klinger's guardrails, and Vanguard
  // Dynamic / Constant % / Endowment's clamp events. RMD-Based and
  // Spending-Decline fire an action every single year (not an event), so
  // they're deliberately excluded — marking every year would be noise, not
  // a signal.
  //
  // Percent context (user follow-up): GK's raise/cut % come straight from
  // its own settings (gkIncreasePct/gkDecreasePct) — the actual % applied
  // that year, not a guess. Vanguard's ceiling/floor % are its YoY change
  // bounds (vdCeilingPercent/vdFloorPercent); Constant %/Endowment's floor
  // is a NOMINAL floor relative to the initial withdrawal
  // (cpFloorPercent/enFloorPercent), a different mechanism from Vanguard's
  // YoY-relative floor, so the wording is strategy-specific, not shared.
  const pct = (v: unknown) => (v != null ? formatPercent(Number(v), 0) : null);
  const gkIncreasePct = pct(engineSettings.gkIncreasePct);
  const gkDecreasePct = pct(engineSettings.gkDecreasePct);
  const vdCeilingPct = pct(engineSettings.vdCeilingPercent);
  const vdFloorPct = pct(engineSettings.vdFloorPercent);
  const cpFloorPct = pct(engineSettings.cpFloorPercent);
  const enFloorPct = pct(engineSettings.enFloorPercent);
  const activeStrategy = engineSettings.withdrawalStrategy;

  const STRATEGY_EVENT_STYLE: Record<
    string,
    { color: string; label: string; tooltipText: string }
  > = {
    increase: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: gkIncreasePct ? `▲ raise +${gkIncreasePct}` : "▲ raise",
      tooltipText: `Upper guardrail triggered — spending raised${gkIncreasePct ? ` ${gkIncreasePct}` : ""}`,
    },
    decrease: {
      color: CHART_COLORS.guardrailDecreaseMarker,
      label: gkDecreasePct ? `▼ cut -${gkDecreasePct}` : "▼ cut",
      tooltipText: `Lower guardrail triggered — spending cut${gkDecreasePct ? ` ${gkDecreasePct}` : ""}`,
    },
    skip_inflation: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label: "⏸ no raise",
      tooltipText:
        "Prosperity rule — inflation raise skipped after a loss year",
    },
    ceiling_applied: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: vdCeilingPct ? `▲ capped @${vdCeilingPct}` : "▲ capped",
      tooltipText: `Year-over-year ceiling reached${vdCeilingPct ? ` (max +${vdCeilingPct}/yr)` : ""} — raise capped, spending still rose just not as much as your balance alone would set`,
    },
    floor_applied: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label:
        activeStrategy === "vanguard_dynamic" && vdFloorPct
          ? `▼ floor @${vdFloorPct}`
          : "▼ floor",
      tooltipText:
        activeStrategy === "vanguard_dynamic"
          ? `Year-over-year floor reached${vdFloorPct ? ` (max -${vdFloorPct}/yr)` : ""} — cut limited, spending still fell just not as much as your balance alone would set`
          : `Nominal floor reached${
              activeStrategy === "endowment"
                ? enFloorPct
                  ? ` (${enFloorPct} of your initial withdrawal)`
                  : ""
                : cpFloorPct
                  ? ` (${cpFloorPct} of your initial withdrawal)`
                  : ""
            } — spending held at the floor instead of following your balance down further`,
    },
  };
  const strategyEventStyleKeys = Object.keys(STRATEGY_EVENT_STYLE);
  const guardrailEvents = years
    .filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation" &&
        y.strategyAction != null &&
        strategyEventStyleKeys.includes(y.strategyAction),
    )
    .map((y) => ({
      age: y.age,
      style: STRATEGY_EVENT_STYLE[y.strategyAction as string]!,
    }));

  return (
    <div className="bg-surface-sunken rounded-lg p-3 chart-fade-in">
      <div className="flex items-start justify-between mb-2 gap-2">
        <h5 className="text-xs font-medium text-muted uppercase">
          Balance Projection
          {isPersonFiltered && (
            <span className="text-caption text-faint font-normal normal-case ml-2">
              {personFilterName}
            </span>
          )}
          {!mcBandsByYear && mcPrefetchQuery.isFetching && (
            <span className="text-micro text-purple-400 animate-pulse ml-2 normal-case font-normal">
              Simulating...
            </span>
          )}
          {hasMc && mcIsPrefetch && (
            <span className="text-micro text-purple-400 ml-2 normal-case font-normal">
              Sim. preview
            </span>
          )}
        </h5>
        <ChartControls state={state} />
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 15, left: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
            <XAxis
              dataKey="age"
              tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.axisMuted }}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.axisLine }}
            />
            <YAxis
              tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.axisMuted }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => compactCurrency(v)}
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
                          <span>Sim. Median</span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d.mc_p50))}
                          </span>
                        </div>
                        <div className="flex justify-between text-purple-400/70">
                          <span>50%</span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d.mc_dp25))}
                            {" –"}
                            {formatCurrency(Number(d.mc_dp75))}
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Milestone events */}
                    {(Number(d._ssStart) === 1 ||
                      Number(d._rmdStart) === 1 ||
                      Number(d._ssIncome) > 0 ||
                      Number(d._rmdAmount) > 0) && (
                      <div className="border-t mt-1 pt-1 space-y-0.5">
                        {Number(d._ssStart) === 1 && (
                          <div className="flex justify-between gap-4 text-teal-400 font-medium">
                            <span>Social Security begins</span>
                            <span className="tabular-nums">
                              {formatCurrency(Number(d._ssIncome))}/yr
                            </span>
                          </div>
                        )}
                        {Number(d._rmdStart) === 1 && (
                          <div className="flex justify-between gap-4 text-amber-400 font-medium">
                            <span>RMDs begin</span>
                            <span className="tabular-nums">
                              {formatCurrency(Number(d._rmdAmount))}
                            </span>
                          </div>
                        )}
                        {Number(d._ssStart) !== 1 &&
                          Number(d._ssIncome) > 0 && (
                            <div className="flex justify-between gap-4 text-teal-400/70 text-caption">
                              <span>Incl. SS income</span>
                              <span className="tabular-nums">
                                {formatCurrency(Number(d._ssIncome))}/yr
                              </span>
                            </div>
                          )}
                        {Number(d._rmdStart) !== 1 &&
                          Number(d._rmdAmount) > 0 && (
                            <div className="flex justify-between gap-4 text-amber-400/70 text-caption">
                              <span>RMD</span>
                              <span className="tabular-nums">
                                {formatCurrency(Number(d._rmdAmount))}
                              </span>
                            </div>
                          )}
                      </div>
                    )}
                    {/* Strategy event detail — same data the chart's
                        ReferenceLine markers flag, now actually explained
                        on hover instead of just labeled. */}
                    {(() => {
                      const eventStyle =
                        typeof d._strategyAction === "string"
                          ? STRATEGY_EVENT_STYLE[d._strategyAction]
                          : undefined;
                      if (!eventStyle) return null;
                      return (
                        <div
                          className="border-t mt-1 pt-1 flex justify-between gap-4 font-medium"
                          style={{ color: eventStyle.color }}
                        >
                          <span>Strategy</span>
                          <span>{eventStyle.tooltipText}</span>
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            />

            {/* MC percentile fan — behind bars */}
            {showMc && (
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
                    fill={CHART_COLORS.mcBandOuter}
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
                    fill={CHART_COLORS.mcBandInner}
                    fillOpacity={0.35}
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="mc_25_75"
                  stackId="mc"
                  fill={CHART_COLORS.mcBandMiddle}
                  fillOpacity={0.2}
                  stroke="none"
                  isAnimationActive={false}
                />
                {fanBandRange !== "p25-p75" && (
                  <Area
                    type="monotone"
                    dataKey="mc_75_90"
                    stackId="mc"
                    fill={CHART_COLORS.mcBandInner}
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
                    fill={CHART_COLORS.mcBandOuter}
                    fillOpacity={0.4}
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
              </>
            )}

            {/* Stacked bars — deterministic breakdown */}
            {showBars &&
              segmentKeys.map((seg, i) => (
                <Bar
                  key={seg.key}
                  dataKey={seg.key}
                  stackId="det"
                  fill={seg.hex}
                  fillOpacity={0.85}
                  isAnimationActive={false}
                  radius={
                    i === segmentKeys.length - 1 ? [2, 2, 0, 0] : undefined
                  }
                />
              ))}

            {/* MC median line */}
            {showMc && (
              <Line
                type="monotone"
                dataKey="mc_p50"
                stroke={CHART_COLORS.mcMedian}
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

            {/* Social Security start age marker */}
            {chartData.some((d) => Number(d.age) === ssStartAge) && (
              <ReferenceLine
                x={ssStartAge}
                stroke={CHART_COLORS.ssMarker}
                strokeDasharray="6 3"
                strokeWidth={1}
                label={{
                  value: "SS",
                  position: "top",
                  fontSize: CHART_FONT.tiny,
                  fill: CHART_COLORS.ssMarker,
                }}
              />
            )}

            {/* RMD start age marker */}
            {rmdStartAge != null &&
              chartData.some((d) => Number(d.age) === rmdStartAge) && (
                <ReferenceLine
                  x={rmdStartAge}
                  stroke={CHART_COLORS.rmdMarker}
                  strokeDasharray="6 3"
                  strokeWidth={1}
                  label={{
                    value: "RMD",
                    position: "top",
                    fontSize: CHART_FONT.tiny,
                    fill: CHART_COLORS.rmdMarker,
                  }}
                />
              )}

            {/* Guyton-Klinger guardrail event markers (R45 Step 5) — a
                household running Guardrails could previously only see
                which years triggered a raise/cut via the table-row
                tooltip; now visible at a glance on the chart too. */}
            {guardrailEvents.map(
              (ev) =>
                chartData.some((d) => Number(d.age) === ev.age) && (
                  <ReferenceLine
                    key={`guardrail-${ev.age}`}
                    x={ev.age}
                    stroke={ev.style.color}
                    strokeDasharray="2 2"
                    strokeWidth={1}
                    label={{
                      value: ev.style.label,
                      position: "insideTopRight",
                      fontSize: CHART_FONT.tiny,
                      fill: ev.style.color,
                    }}
                  />
                ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-caption text-faint flex-wrap">
        {segmentKeys.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded"
              style={{ backgroundColor: seg.hex }}
            />{" "}
            {seg.label}
          </span>
        ))}
        {hasMc && (
          <>
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: CHART_COLORS.mcMedian }}
              />{" "}
              Sim. median
              {mcIsPrefetch && (
                <span className="text-faint ml-0.5">(preview)</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-1.5 rounded"
                style={{
                  backgroundColor: CHART_COLORS.mcBandMiddle,
                  opacity: 0.3,
                }}
              />{" "}
              50% band
            </span>
            {fanBandRange !== "p25-p75" && (
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-1.5 rounded"
                  style={{
                    backgroundColor:
                      fanBandRange === "p5-p95"
                        ? CHART_COLORS.mcBandOuter
                        : CHART_COLORS.mcBandInner,
                    opacity: fanBandRange === "p5-p95" ? 0.6 : 0.5,
                  }}
                />{" "}
                {fanBandRange === "p10-p90" ? "80% band" : "90% band"}
              </span>
            )}
          </>
        )}
        {chartData.some((d) => Number(d._ssIncome) > 0) && (
          <span className="flex items-center gap-1">
            <span
              className="w-3 h-0.5 rounded"
              style={{ backgroundColor: CHART_COLORS.ssMarker }}
            />
            SS Start
          </span>
        )}
        {rmdStartAge != null &&
          chartData.some((d) => Number(d._rmdAmount) > 0) && (
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: CHART_COLORS.rmdMarker }}
              />
              RMD Start
            </span>
          )}
      </div>
    </div>
  );
}
