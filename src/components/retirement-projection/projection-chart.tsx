"use client";

/** Balance projection chart — stacked bar (deterministic) + confidence bands + median line. */
import { gkAnchorRate } from "@/lib/pure/retirement/gk-anchor-rate";
import {
  taxTypeLabel,
  categoryChartHex,
  TAX_PIE_COLORS,
  CHART_COLORS,
  chartLinePalette,
} from "@/lib/utils/colors";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  formatCurrency,
  compactCurrency,
  formatPercent,
} from "@/lib/utils/format";
import {
  buildStrategyEventStyle,
  tipColorClass,
  formatDiscretionaryTierBreakdown,
} from "./utils";
import type { EngineYearProjection } from "@/lib/pure/engine/types";
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
} from "recharts";
import { getAccountSegments } from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/config/account-balance";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { ChartFrame } from "@/components/charts/chart-frame";
import { balanceSummary } from "./projection-chart.summary";
import { TOOLTIP_SURFACE_CLASSES } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { ProjectionState } from "./projection-table-types";
import { renderRetirementLine } from "./retirement-year-line";

// Skeleton lives in its own file so the parent (retirement-projection/index.tsx)
// can render it without pulling recharts in via this module's import graph.
export { ProjectionChartSkeleton } from "./projection-chart-skeleton";

// The sporadic per-strategy spending adjustments worth marking, read by both
// the chart-data pinning pass and the marker/tooltip build. RMD-Based and
// Spending-Decline act every year, so they are not events.
const STRATEGY_EVENT_KEYS = [
  "increase",
  "decrease",
  "skip_inflation",
  "ceiling_applied",
  "floor_applied",
] as const;

export function ProjectionChart({ state }: { state: ProjectionState }) {
  const c = {
    ...CHART_COLORS,
    ...chartLinePalette(useTheme().resolvedTheme === "dark"),
  };
  // Check `state.result` before destructuring: TS only narrows
  // engineSettings (defined whenever result is) through the object.
  if (!state.result) return null;

  const {
    result,
    engineSettings,
    isPersonFiltered,
    personFilterName,
    getPersonYearTotals,
    agesInYear,
    deflate,
    simulationBandsByYear,
    mcPrefetchQuery,
    simulationIsPrefetch,
    visibleColumns,
    columnLabel,
    balanceView,
    fanBandRange,
  } = state;

  // Bars always show standalone deterministic projection.
  // MC fan bands + median line overlay on top via simulationBandsByYear.
  const years = result.projectionByYear;
  // As the engine reads them: no post-retirement rate = the general rate.
  const generalInflation = Number(engineSettings.annualInflation);
  const postRetirementInflation = engineSettings.postRetirementInflation
    ? Number(engineSettings.postRetirementInflation)
    : generalInflation;
  const gkAnchor =
    engineSettings.withdrawalStrategy === "guyton_klinger"
      ? gkAnchorRate(years)
      : null;
  const retirementIndex = years.findIndex((y) => y.phase === "decumulation");
  const retYear = years[retirementIndex]?.year ?? null;
  // Also pin the SS and RMD start years so milestone reference lines always
  // appear, even when those years fall on an odd-indexed (normally skipped) one.
  const socialSecurityIndex = years.findIndex(
    (y) => y.phase === "decumulation" && y.ssIncome > 0,
  );
  const ssStartYear = years[socialSecurityIndex]?.year ?? null;
  const rmdIndex = years.findIndex(
    (y) => y.phase === "decumulation" && y.rmdAmount > 0,
  );
  const rmdStartYear = years[rmdIndex]?.year ?? null;
  // Guyton-Klinger guardrail event years: pinned like SS/RMD start ages so
  // an odd-indexed event year doesn't vanish from the downsampled chart data.
  const guardrailIndices = new Set(
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
      i === retirementIndex ||
      i === socialSecurityIndex ||
      (rmdIndex !== -1 && i === rmdIndex) ||
      guardrailIndices.has(i),
  );

  const TAX_KEYS = (["preTax", "taxFree", "hsa", "afterTax"] as const).filter(
    (t) => visibleColumns.balanceTaxTypes.has(t),
  );

  // Account-level chart segments
  const ACCOUNT_SEGMENTS = getAccountSegments()
    .map((seg) => ({
      key: seg.key,
      hex: categoryChartHex(seg.category, seg.subKey === "roth"),
      label: columnLabel[seg.key] ?? seg.label,
      get: (yearRow: EngineYearProjection) =>
        getSegmentBalance(yearRow.balanceByAccount, seg),
    }))
    .filter((seg) => visibleColumns.balanceAccounts.has(seg.key));

  // Build chart data
  const chartData = filtered.map((yearRow) => {
    const pt = getPersonYearTotals(yearRow);
    const datum: Record<string, number | string> = {
      year: yearRow.year,
    };

    if (balanceView === "taxType") {
      for (const key of TAX_KEYS) {
        const val = pt ? pt.byTaxType[key] : yearRow.balanceByTaxType[key];
        datum[key] = Math.max(0, deflate(val, yearRow.year));
      }
    } else {
      for (const seg of ACCOUNT_SEGMENTS) {
        const val = pt ? (pt.byAccount[seg.key] ?? 0) : seg.get(yearRow);
        datum[seg.key] = Math.max(0, deflate(val, yearRow.year));
      }
    }

    // MC percentile band areas — already in the shown dollars
    // (simulationDollars: today's are deflated per trial), never deflated
    // here.
    const band = simulationBandsByYear?.get(yearRow.year);
    // This year's assumptions, for the tooltip.
    datum._planReturn = yearRow.annualizedReturnRate;
    datum._inflation =
      yearRow.phase === "decumulation"
        ? postRetirementInflation
        : generalInflation;
    if (band?.assumptions) {
      datum._simReturn = band.assumptions.expectedReturn;
      datum._simVolatility = band.assumptions.volatility;
      if (band.assumptions.inflation) {
        const { stdDev, priceLevel } = band.assumptions.inflation;
        datum._simInflationSd = stdDev;
        datum._pricesP25 = priceLevel.p25;
        datum._pricesP50 = priceLevel.p50;
        datum._pricesP75 = priceLevel.p75;
      }
    }
    if (yearRow.phase === "decumulation" && gkAnchor !== null) {
      datum._gkAnchor = gkAnchor;
      const range = band?.assumptions?.gkAnchorRange;
      if (range) {
        datum._gkAnchorP25 = range.p25;
        datum._gkAnchorP75 = range.p75;
      }
    }
    if (band) {
      const dp5 = band.p5;
      const dp10 = band.p10;
      const dp25 = band.p25;
      const dp50 = band.p50;
      const dp75 = band.p75;
      const dp90 = band.p90;
      const dp95 = band.p95;
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

    // A year a paycheck is gone: what came out while still saving.
    if (yearRow.phase === "accumulation" && yearRow.gapDraw) {
      datum._gapWithdrawal = deflate(yearRow.gapDraw.withdrawal, yearRow.year);
      datum._gapSaved = deflate(
        yearRow.totalEmployee + yearRow.totalEmployer,
        yearRow.year,
      );
      datum._gapPayIn = deflate(
        yearRow.gapDraw.pay + yearRow.gapDraw.ssIncome,
        yearRow.year,
      );
      datum._gapSpendingCut = deflate(
        yearRow.gapDraw.spendingCut,
        yearRow.year,
      );
    }

    // Milestone event annotations (decumulation only)
    if (yearRow.phase === "decumulation") {
      datum._ssStart = yearRow.year === ssStartYear ? 1 : 0;
      datum._rmdStart = yearRow.year === rmdStartYear ? 1 : 0;
      // All dollar figures below go through deflate() like every other value
      // in this chart, so they match the table tooltip in "Today's $" mode.
      datum._ssIncome = deflate(yearRow.ssIncome, yearRow.year);
      // Total portfolio withdrawal (all accounts, tax-grossed-up per
      // grossUpForTaxes): the "Income" overlay series, alongside SS.
      datum._totalWithdrawal = deflate(yearRow.totalWithdrawal, yearRow.year);
      datum._rmdAmount = deflate(yearRow.rmdAmount, yearRow.year);
      // RMD-forced excess reinvested into brokerage; unlike `_rmdStart` it can
      // be nonzero in any decumulation year, so it shows on hover when it occurs.
      datum._rmdExcessAmount = deflate(yearRow.rmdExcessAmount, yearRow.year);
      // QCD — sent directly to charity, satisfying part of the RMD without
      // taxable income. It bypasses withdrawal routing, so no line item
      // would show it otherwise.
      datum._qcdAmount = deflate(yearRow.qcdAmount, yearRow.year);
      // RMD dollars that could NOT be forced out as a taxable distribution;
      // usually 0. See rmd-enforcement.ts rmdShortfallAmount for when
      // Retirement-only capacity runs short.
      datum._rmdShortfallAmount = deflate(
        yearRow.rmdShortfallAmount,
        yearRow.year,
      );
      // Real, material unmet-need shortfall —
      // threaded through the same way SS/RMD milestones are so hovering
      // this exact year shows WHY it's marked, not just that it is.
      datum._unmetNeedMaterial = yearRow.unmetNeedMaterial ? 1 : 0;
      datum._unmetNeed = deflate(yearRow.unmetNeed ?? 0, yearRow.year);
      datum._unmetNeedNonRetirement = deflate(
        yearRow.nonRetirementShortfall ?? 0,
        yearRow.year,
      );
      datum._unmetNeedPenaltyAvoided = deflate(
        yearRow.penaltyAvoidedShortfall ?? 0,
        yearRow.year,
      );
      // Guardrail event detail for the tooltip on a marked year.
      datum._strategyAction = yearRow.strategyAction ?? "";
      // "Why was this account used" hover note (see utils.ts
      // formatDiscretionaryTierBreakdown), pre-formatted since this datum
      // otherwise only carries numbers/flags for Recharts' dataKey lookups.
      datum._discretionaryRoutingNote =
        formatDiscretionaryTierBreakdown(
          yearRow.discretionaryTierBreakdown?.map((t) => ({
            ...t,
            amount: deflate(t.amount, yearRow.year),
          })),
        ) ?? "";
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
      : ACCOUNT_SEGMENTS.map((s) => ({
          key: s.key,
          hex: s.hex,
          label: s.label,
        }));

  const hasSimulationData = simulationBandsByYear != null;
  const showSimulation = hasSimulationData && fanBandRange !== "off";
  const { showBars, showIncome } = state;

  // Income overlay (withdrawal + SS, secondary axis) only when there is
  // nonzero decumulation data; accumulation-only projections have none.
  const hasIncomeData = chartData.some(
    (d) => Number(d._totalWithdrawal) > 0 || Number(d._ssIncome) > 0,
  );
  const showIncomeOverlay = showIncome && hasIncomeData;

  // Markers for sporadic strategy adjustments (Guyton-Klinger guardrails;
  // Vanguard Dynamic / Constant % / Endowment clamps). Every-year actions are
  // excluded as noise. Styling is shared with the table tooltip via utils.ts.
  const STRATEGY_EVENT_STYLE = buildStrategyEventStyle(engineSettings);
  const strategyEventStyleKeys = Object.keys(STRATEGY_EVENT_STYLE);
  const guardrailEvents = years
    .filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation" &&
        y.strategyAction != null &&
        strategyEventStyleKeys.includes(y.strategyAction),
    )
    .map((y) => ({
      year: y.year,
      style: STRATEGY_EVENT_STYLE[y.strategyAction as string]!,
    }));

  // Years where the plan couldn't deliver the money it called for. Separate
  // from guardrailEvents since a cut year can also be a shortfall year.
  // unmetNeedMaterial is the engine's canonical verdict (raw unmetNeed isn't).
  const shortfallEvents = years
    .filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation" && y.unmetNeedMaterial === true,
    )
    .map((y) => ({ year: y.year, amount: y.unmetNeed ?? 0 }));

  return (
    <div className="bg-surface-sunken chart-fade-in rounded-lg p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h5 className="text-muted text-xs font-medium uppercase">
          <Badge color="blue" case="normal" className="mr-1.5">
            $
          </Badge>
          Balance Projection
          {isPersonFiltered && (
            <span className="text-caption text-faint ml-2 font-normal normal-case">
              {personFilterName}
            </span>
          )}
          {!simulationBandsByYear && mcPrefetchQuery.isFetching && (
            <span className="text-micro ml-2 animate-pulse font-normal text-purple-600 normal-case">
              Simulating...
            </span>
          )}
          {hasSimulationData && simulationIsPrefetch && (
            <span className="text-micro ml-2 font-normal text-purple-600 normal-case">
              Sim. preview
            </span>
          )}
        </h5>
      </div>
      {/* Deterministic shortfall alert, its own callout: the Lifetime Income
          Stability ring is a 1000-trial aggregate, while this is the single
          deterministic path shown in this chart. */}
      {shortfallEvents.length > 0 && (
        <div className="text-micro mb-2 rounded bg-red-50 px-2 py-1 text-red-600">
          ⚠ {shortfallEvents.length} year
          {shortfallEvents.length === 1 ? "" : "s"} in this deterministic
          projection couldn&apos;t fund the actual spending need — see the
          marked ages below.
        </div>
      )}
      <div className="h-[320px]">
        <ChartFrame summary={balanceSummary(chartData, segmentKeys)}>
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 15, left: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.axisMuted }}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.axisLine }}
            />
            <YAxis
              yAxisId="balance"
              tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.axisMuted }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => compactCurrency(v)}
              width={55}
            />
            {showIncomeOverlay && (
              <YAxis
                yAxisId="income"
                orientation="right"
                tick={{
                  fontSize: CHART_FONT.tick,
                  fill: CHART_COLORS.axisMuted,
                }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => compactCurrency(v)}
                width={55}
              />
            )}
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null; // Recharts' runtime props, not our types: kept guarded.
                const d = payload[0]?.payload;
                if (!d) return null;
                const totalBalance = segmentKeys.reduce(
                  (s, k) => s + (Number(d[k.key]) || 0),
                  0,
                );
                // RMD status for the line(s) below: a shortfall (IRS excise-tax
                // exposure) shows in red; otherwise a checkmark whenever the
                // RMD was met.
                const rmdShortfall = Number(d._rmdShortfallAmount) > 0;
                const rmdSatisfiedNotably = !rmdShortfall;
                const eventStyle =
                  typeof d._strategyAction === "string"
                    ? STRATEGY_EVENT_STYLE[d._strategyAction]
                    : undefined;
                return (
                  <div
                    className={`${TOOLTIP_SURFACE_CLASSES} max-w-xs text-xs`}
                  >
                    <div className="mb-1 font-medium">
                      {d.year}
                      {agesInYear(Number(d.year)).map((p) => (
                        <span
                          key={p.name}
                          className="text-muted ml-2 font-normal"
                        >
                          {p.name}: {p.age}
                        </span>
                      ))}
                    </div>
                    {(Number(d._gapWithdrawal) > 0 ||
                      Number(d._gapSpendingCut) > 0) && (
                      <div className="mb-1 border-b pb-1">
                        <div className="text-muted">A paycheck is gone</div>
                        <div className="flex justify-between gap-4">
                          <span>In: pay and benefits</span>
                          <span>{formatCurrency(Number(d._gapPayIn))}</span>
                        </div>
                        {Number(d._gapWithdrawal) > 0 && (
                          <div className="flex justify-between gap-4 text-amber-500">
                            <span>In: from accounts</span>
                            <span>
                              {formatCurrency(Number(d._gapWithdrawal))}
                            </span>
                          </div>
                        )}
                        {Number(d._gapSaved) > 0 && (
                          <div className="flex justify-between gap-4 text-green-500">
                            <span>Out: into accounts (match included)</span>
                            <span>{formatCurrency(Number(d._gapSaved))}</span>
                          </div>
                        )}
                        {Number(d._gapSpendingCut) > 0 && (
                          <div className="text-amber-500">
                            Spending {formatCurrency(Number(d._gapSpendingCut))}{" "}
                            under budget (you chose not to withdraw)
                          </div>
                        )}
                      </div>
                    )}
                    {segmentKeys
                      .filter((k) => (Number(d[k.key]) || 0) > 0)
                      .map((k) => (
                        <div key={k.key} className="flex justify-between gap-4">
                          <span className="flex items-center gap-1">
                            <span
                              className="h-2 w-2 rounded"
                              style={{ backgroundColor: k.hex }}
                            />
                            {k.label}
                          </span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d[k.key]))}
                          </span>
                        </div>
                      ))}
                    <div className="mt-1 flex justify-between border-t border-white/10 pt-1 font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {formatCurrency(totalBalance)}
                      </span>
                    </div>
                    {hasSimulationData && d.mc_p50 != null && (
                      <div className="mt-1 border-t border-white/10 pt-1">
                        <div
                          className={`flex justify-between ${tipColorClass.purple}`}
                        >
                          <span>Typical outcome</span>
                          <span className="tabular-nums">
                            {formatCurrency(Number(d.mc_p50))}
                          </span>
                        </div>
                        <div className={`${tipColorClass.purple}/70 mt-0.5`}>
                          <div>Likely range:</div>
                          <div className="tabular-nums">
                            {formatCurrency(Number(d.mc_dp25))}
                            {" – "}
                            {formatCurrency(Number(d.mc_dp75))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="text-muted mt-1 border-t border-white/10 pt-1">
                      <div className="flex justify-between gap-4">
                        <span>Assumed return</span>
                        <span className="tabular-nums">
                          {formatPercent(Number(d._planReturn), 1)}
                        </span>
                      </div>
                      {d._simReturn != null && (
                        <div className="flex justify-between gap-4">
                          <span>Simulation return</span>
                          <span className="tabular-nums">
                            {formatPercent(Number(d._simReturn), 1)} ±{" "}
                            {formatPercent(Number(d._simVolatility), 1)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between gap-4">
                        <span>Inflation</span>
                        <span className="tabular-nums">
                          {formatPercent(Number(d._inflation), 1)}
                          {d._simInflationSd != null &&
                            ` ± ${formatPercent(Number(d._simInflationSd), 1)}`}
                        </span>
                      </div>
                      {d._pricesP50 != null && Number(d._pricesP75) > 1 && (
                        <div className="flex justify-between gap-4">
                          <span>Prices vs today</span>
                          <span className="tabular-nums">
                            ×{Number(d._pricesP50).toFixed(2)} (likely ×
                            {Number(d._pricesP25).toFixed(2)}–
                            {Number(d._pricesP75).toFixed(2)})
                          </span>
                        </div>
                      )}
                      {d._gkAnchor != null && (
                        <div className="flex justify-between gap-4">
                          <span>Anchor rate</span>
                          <span className="tabular-nums">
                            {formatPercent(Number(d._gkAnchor), 2)}
                            {d._gkAnchorP25 != null &&
                              ` (likely ${formatPercent(Number(d._gkAnchorP25), 1)}–${formatPercent(Number(d._gkAnchorP75), 1)})`}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Milestone events */}
                    {(Number(d._ssStart) === 1 ||
                      Number(d._rmdStart) === 1 ||
                      Number(d._ssIncome) > 0 ||
                      Number(d._rmdAmount) > 0 ||
                      Number(d._rmdExcessAmount) > 0 ||
                      Number(d._qcdAmount) > 0 ||
                      Number(d._totalWithdrawal) > 0 ||
                      Number(d._unmetNeedMaterial) === 1 ||
                      rmdShortfall) && (
                      <div className="mt-1 space-y-0.5 border-t border-white/10 pt-1">
                        {Number(d._totalWithdrawal) > 0 && (
                          <div
                            className={`flex justify-between gap-4 ${tipColorClass.blue}`}
                          >
                            <span>Portfolio withdrawal</span>
                            <span className="tabular-nums">
                              {formatCurrency(Number(d._totalWithdrawal))}/yr
                            </span>
                          </div>
                        )}
                        {typeof d._discretionaryRoutingNote === "string" &&
                          d._discretionaryRoutingNote && (
                            <div
                              className={`${tipColorClass.gray} text-[11px]`}
                            >
                              {d._discretionaryRoutingNote}
                            </div>
                          )}
                        {Number(d._unmetNeedMaterial) === 1 && (
                          <>
                            <div className="flex justify-between gap-4 font-medium text-red-400">
                              <span>⚠ Unmet need</span>
                              <span className="tabular-nums">
                                -{formatCurrency(Number(d._unmetNeed))}
                              </span>
                            </div>
                            {Number(d._unmetNeedNonRetirement) > 0 && (
                              <div className="text-caption flex justify-between gap-4 text-red-400/70">
                                <span>
                                  · excluding non-retirement (Portfolio)
                                  accounts
                                </span>
                                <span className="tabular-nums">
                                  -
                                  {formatCurrency(
                                    Number(d._unmetNeedNonRetirement),
                                  )}
                                </span>
                              </div>
                            )}
                            {Number(d._unmetNeedPenaltyAvoided) > 0 && (
                              <div className="text-caption flex justify-between gap-4 text-red-400/70">
                                <span>· excluding penalty-exposed money</span>
                                <span className="tabular-nums">
                                  -
                                  {formatCurrency(
                                    Number(d._unmetNeedPenaltyAvoided),
                                  )}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                        {Number(d._ssStart) === 1 && (
                          <div
                            className={`flex justify-between gap-4 ${tipColorClass.teal} font-medium`}
                          >
                            <span>Social Security begins</span>
                            <span className="tabular-nums">
                              {formatCurrency(Number(d._ssIncome))}/yr
                            </span>
                          </div>
                        )}
                        {Number(d._rmdStart) === 1 && (
                          <div
                            className={
                              rmdShortfall ? "text-red-400" : "text-amber-600"
                            }
                          >
                            <div className="flex justify-between gap-4 font-medium">
                              <span>RMDs begin</span>
                              <span className="tabular-nums">
                                {formatCurrency(Number(d._rmdAmount))}
                              </span>
                            </div>
                            {rmdSatisfiedNotably && (
                              <div className="text-caption opacity-80">
                                Your withdrawals covered this required amount in
                                full.
                              </div>
                            )}
                          </div>
                        )}
                        {Number(d._ssStart) !== 1 &&
                          Number(d._ssIncome) > 0 && (
                            <div
                              className={`flex justify-between gap-4 ${tipColorClass.teal}/70 text-caption`}
                            >
                              <span>Incl. SS income</span>
                              <span className="tabular-nums">
                                {formatCurrency(Number(d._ssIncome))}/yr
                              </span>
                            </div>
                          )}
                        {Number(d._rmdStart) !== 1 &&
                          Number(d._rmdAmount) > 0 && (
                            <div
                              className={
                                rmdShortfall
                                  ? "text-red-400"
                                  : `${tipColorClass.amber}/70`
                              }
                            >
                              <div className="text-caption flex justify-between gap-4">
                                <span>RMD (required withdrawal)</span>
                                <span className="tabular-nums">
                                  {formatCurrency(Number(d._rmdAmount))}
                                </span>
                              </div>
                              {rmdSatisfiedNotably && (
                                <div className="text-micro opacity-80">
                                  Met in full by your withdrawals.
                                </div>
                              )}
                            </div>
                          )}
                        {/* RMD shortfall: real IRS excise-tax exposure, so it
                            gets its own line in red, breaking the amber
                            RMD/QCD family to read as an alarm. */}
                        {rmdShortfall && (
                          <div className="text-caption text-red-400/70">
                            Only{" "}
                            {formatCurrency(
                              Number(d._rmdAmount) -
                                Number(d._rmdShortfallAmount),
                            )}{" "}
                            of {formatCurrency(Number(d._rmdAmount))} required
                            met · 25% excise tax risk
                          </div>
                        )}
                        {/* RMD-forced excess beyond what the strategy needed;
                            can recur every RMD year. Wording follows
                            rmdExcessHandling (nothing is reinvested on "spend"). */}
                        {Number(d._rmdExcessAmount) > 0 && (
                          <div
                            className={`flex justify-between gap-4 ${tipColorClass.amber}/70 text-caption`}
                          >
                            <span>
                              {engineSettings.rmdExcessHandling === "spend"
                                ? "RMD excess spent"
                                : "RMD excess reinvested"}
                            </span>
                            <span className="tabular-nums">
                              {engineSettings.rmdExcessHandling === "spend"
                                ? ""
                                : "+"}
                              {formatCurrency(Number(d._rmdExcessAmount))}
                            </span>
                          </div>
                        )}
                        {/* QCD — sent directly to charity, satisfying part
                            of the RMD without becoming taxable income. */}
                        {Number(d._qcdAmount) > 0 && (
                          <div
                            className={`flex justify-between gap-4 ${tipColorClass.violet}/70 text-caption`}
                          >
                            <span>QCD to charity</span>
                            <span className="tabular-nums">
                              {formatCurrency(Number(d._qcdAmount))}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Strategy event detail — same data the chart's
                        ReferenceLine markers flag, now actually explained
                        on hover instead of just labeled. */}
                    {eventStyle ? (
                      <div
                        className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-1 font-medium"
                        style={{ color: eventStyle.color }}
                      >
                        <span>Strategy</span>
                        <span>{eventStyle.tooltipText}</span>
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />

            {/* MC percentile fan — behind bars */}
            {showSimulation && (
              <>
                <Area
                  type="monotone"
                  yAxisId="balance"
                  dataKey="mc_base"
                  stackId="mc"
                  fill="transparent"
                  stroke="none"
                  isAnimationActive={false}
                />
                {fanBandRange === "p5-p95" && (
                  <Area
                    type="monotone"
                    yAxisId="balance"
                    dataKey="mc_5_10"
                    stackId="mc"
                    fill={CHART_COLORS.simulationBandOuter}
                    fillOpacity={0.4}
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
                {fanBandRange !== "p25-p75" && (
                  <Area
                    type="monotone"
                    yAxisId="balance"
                    dataKey="mc_10_25"
                    stackId="mc"
                    fill={CHART_COLORS.simulationBandInner}
                    fillOpacity={0.35}
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
                <Area
                  type="monotone"
                  yAxisId="balance"
                  dataKey="mc_25_75"
                  stackId="mc"
                  fill={CHART_COLORS.simulationBandMiddle}
                  fillOpacity={0.2}
                  stroke="none"
                  isAnimationActive={false}
                />
                {fanBandRange !== "p25-p75" && (
                  <Area
                    type="monotone"
                    yAxisId="balance"
                    dataKey="mc_75_90"
                    stackId="mc"
                    fill={CHART_COLORS.simulationBandInner}
                    fillOpacity={0.35}
                    stroke="none"
                    isAnimationActive={false}
                  />
                )}
                {fanBandRange === "p5-p95" && (
                  <Area
                    type="monotone"
                    yAxisId="balance"
                    dataKey="mc_90_95"
                    stackId="mc"
                    fill={CHART_COLORS.simulationBandOuter}
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
                  yAxisId="balance"
                  stackId="det"
                  fill={seg.hex}
                  fillOpacity={0.85}
                  isAnimationActive={false}
                  radius={
                    i === segmentKeys.length - 1 ? [2, 2, 0, 0] : undefined
                  }
                />
              ))}

            {/* Decumulation-year income overlay on the right-hand axis: total
                portfolio withdrawal and Social Security as two lines, not
                stacked, since they come from different sources. */}
            {showIncomeOverlay && (
              <>
                <Line
                  type="monotone"
                  yAxisId="income"
                  dataKey="_totalWithdrawal"
                  name="Portfolio withdrawal"
                  stroke={c.withdrawalFlow}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  yAxisId="income"
                  dataKey="_ssIncome"
                  name="Social Security"
                  stroke={CHART_COLORS.ssMarker}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              </>
            )}

            {/* MC median line */}
            {showSimulation && (
              <Line
                type="monotone"
                yAxisId="balance"
                dataKey="mc_p50"
                stroke={c.simulationMedian}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                isAnimationActive={false}
              />
            )}

            {/* Retirement age reference line */}
            {renderRetirementLine(chartData, retYear)}

            {/* Social Security start age marker */}
            {chartData.some((d) => Number(d.year) === ssStartYear) && (
              <ReferenceLine
                yAxisId="balance"
                x={ssStartYear ?? undefined}
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
            {rmdStartYear != null &&
              chartData.some((d) => Number(d.year) === rmdStartYear) && (
                <ReferenceLine
                  yAxisId="balance"
                  x={rmdStartYear}
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

            {/* Guyton-Klinger guardrail event markers: the years a raise or
                cut triggered. */}
            {guardrailEvents.map(
              (ev) =>
                chartData.some((d) => Number(d.year) === ev.year) && (
                  <ReferenceLine
                    key={`guardrail-${ev.year}`}
                    yAxisId="balance"
                    x={ev.year}
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

            {/* Material unmet-need shortfall markers, separate from the
                guardrail markers (see shortfallEvents); darker red so they
                read as a "couldn't fund it" alarm. */}
            {shortfallEvents.map(
              (ev) =>
                chartData.some((d) => Number(d.year) === ev.year) && (
                  <ReferenceLine
                    key={`shortfall-${ev.year}`}
                    yAxisId="balance"
                    x={ev.year}
                    stroke={CHART_COLORS.shortfallMarker}
                    strokeDasharray="2 2"
                    strokeWidth={1.5}
                    label={{
                      value: "⚠ unmet",
                      position: "insideBottomRight",
                      fontSize: CHART_FONT.tiny,
                      fill: CHART_COLORS.shortfallMarker,
                    }}
                  />
                ),
            )}
          </ComposedChart>
        </ChartFrame>
      </div>
      {/* Legend */}
      <div className="text-caption text-faint mt-2 flex flex-wrap items-center gap-3">
        {segmentKeys.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded"
              style={{ backgroundColor: seg.hex }}
            />{" "}
            {seg.label}
          </span>
        ))}
        {showIncomeOverlay && (
          <>
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-3 rounded"
                style={{ backgroundColor: c.withdrawalFlow }}
              />{" "}
              Withdrawal
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-3 rounded"
                style={{ backgroundColor: CHART_COLORS.ssMarker }}
              />{" "}
              SS Income
            </span>
          </>
        )}
        {hasSimulationData && (
          <>
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-3 rounded"
                style={{ backgroundColor: c.simulationMedian }}
              />{" "}
              Sim. median
              {simulationIsPrefetch && (
                <span className="text-faint ml-0.5">(preview)</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-3 rounded"
                style={{
                  backgroundColor: CHART_COLORS.simulationBandMiddle,
                  opacity: 0.3,
                }}
              />{" "}
              50% band
            </span>
            {fanBandRange !== "p25-p75" && (
              <span className="flex items-center gap-1">
                <span
                  className="h-1.5 w-3 rounded"
                  style={{
                    backgroundColor:
                      fanBandRange === "p5-p95"
                        ? CHART_COLORS.simulationBandOuter
                        : CHART_COLORS.simulationBandInner,
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
              className="h-0.5 w-3 rounded"
              style={{ backgroundColor: CHART_COLORS.ssMarker }}
            />
            SS Start
          </span>
        )}
        {rmdStartYear != null &&
          chartData.some((d) => Number(d._rmdAmount) > 0) && (
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-3 rounded"
                style={{ backgroundColor: CHART_COLORS.rmdMarker }}
              />
              RMD Start
            </span>
          )}
        {shortfallEvents.length > 0 && (
          <span className="flex items-center gap-1">
            <span
              className="h-0.5 w-3 rounded"
              style={{ backgroundColor: CHART_COLORS.shortfallMarker }}
            />
            Unmet Need
          </span>
        )}
      </div>
    </div>
  );
}
