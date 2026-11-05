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
  ResponsiveContainer,
} from "recharts";
import { getAccountSegments } from "@/lib/config/account-types";
import { getSegmentBalance } from "@/lib/config/account-balance";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { TOOLTIP_SURFACE_CLASSES } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { ProjectionState } from "./projection-table-types";

// Skeleton lives in its own file so the parent (cards/projection/index.tsx)
// can render it without pulling recharts in via this module's import graph.
export { ProjectionChartSkeleton } from "./projection-chart-skeleton";

// Recognized sporadic per-strategy spending-adjustment events — shared
// between the early chart-data pinning pass and the
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
  const c = {
    ...CHART_COLORS,
    ...chartLinePalette(useTheme().resolvedTheme === "dark"),
  };
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
    agesInYear,
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
  // As the engine reads them: no post-retirement rate = the general rate.
  const generalInflation = Number(engineSettings.annualInflation);
  const postRetirementInflation = engineSettings.postRetirementInflation
    ? Number(engineSettings.postRetirementInflation)
    : generalInflation;
  const gkAnchor =
    engineSettings.withdrawalStrategy === "guyton_klinger"
      ? gkAnchorRate(years)
      : null;
  const retIdx = years.findIndex((y) => y.phase === "decumulation");
  const retYear = years[retIdx]?.year ?? null;
  // Also pin the SS and RMD start years so milestone reference lines always
  // appear, even when those years fall on an odd-indexed (normally skipped) one.
  const ssIdx = years.findIndex(
    (y) => y.phase === "decumulation" && y.ssIncome > 0,
  );
  const ssStartYear = years[ssIdx]?.year ?? null;
  const rmdIdx = years.findIndex(
    (y) => y.phase === "decumulation" && y.rmdAmount > 0,
  );
  const rmdStartYear = years[rmdIdx]?.year ?? null;
  // Guyton-Klinger guardrail events (data already computed and
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

    // MC percentile band areas — already in the shown dollars
    // (simulationDollars: today's are deflated per trial), never deflated
    // here.
    const band = mcBandsByYear?.get(yr.year);
    // This year's assumptions, for the tooltip.
    datum._planReturn = yr.annualizedReturnRate;
    datum._inflation =
      yr.phase === "decumulation" ? postRetirementInflation : generalInflation;
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
    if (yr.phase === "decumulation" && gkAnchor !== null) {
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
    if (yr.phase === "accumulation" && yr.gapDraw) {
      datum._gapWithdrawal = deflate(yr.gapDraw.withdrawal, yr.year);
      datum._gapSaved = deflate(yr.totalEmployee + yr.totalEmployer, yr.year);
      datum._gapPayIn = deflate(yr.gapDraw.pay + yr.gapDraw.ssIncome, yr.year);
      datum._gapSpendingCut = deflate(yr.gapDraw.spendingCut, yr.year);
    }

    // Milestone event annotations (decumulation only)
    if (yr.phase === "decumulation") {
      datum._ssStart = yr.year === ssStartYear ? 1 : 0;
      datum._rmdStart = yr.year === rmdStartYear ? 1 : 0;
      // All dollar figures below go through deflate() like every other
      // dollar value this chart renders (balances, MC bands) — previously
      // raw nominal dollars regardless of the Today's $/Future $ toggle
      // (the table's own tooltip already
      // deflates the same underlying fields via `dyr.rmdAmount` etc.,
      // so the chart and table disagreed on every one of these numbers
      // in "Today's $" mode).
      datum._ssIncome = deflate(yr.ssIncome, yr.year);
      // Total portfolio withdrawal (all accounts/tax types combined,
      // already tax-grossed-up per grossUpForTaxes) — the "Income" overlay
      // series below, alongside SS. Real strategy-computed spending, not a
      // derived/estimated figure.
      datum._totalWithdrawal = deflate(yr.totalWithdrawal, yr.year);
      datum._rmdAmount = deflate(yr.rmdAmount, yr.year);
      // RMD-forced excess reinvested into brokerage — unlike
      // `_rmdStart` (which only flags the single year RMDs begin), this can
      // be nonzero in ANY decumulation year, so it's shown on hover
      // whenever it happens, not just at the milestone.
      datum._rmdExcessAmount = deflate(yr.rmdExcessAmount ?? 0, yr.year);
      // QCD amount — money sent directly to charity, satisfying part
      // of the RMD without counting as taxable income. Same "invisible
      // unless surfaced explicitly" issue as the excess line above; QCD
      // bypasses withdrawal routing entirely, so there's no slot/
      // withdrawal line item that would show it otherwise.
      datum._qcdAmount = deflate(yr.qcdAmount ?? 0, yr.year);
      // Dollars of this year's RMD that could NOT be forced through as
      // a real taxable distribution — 0 in the overwhelmingly common case.
      // See rmd-enforcement.ts's rmdShortfallAmount docblock for why this
      // is now possible (Retirement-only capacity can be genuinely
      // insufficient once Portfolio-parented balances no longer count).
      datum._rmdShortfallAmount = deflate(yr.rmdShortfallAmount ?? 0, yr.year);
      // Real, material unmet-need shortfall —
      // threaded through the same way SS/RMD milestones are so hovering
      // this exact year shows WHY it's marked, not just that it is.
      datum._unmetNeedMaterial = yr.unmetNeedMaterial ? 1 : 0;
      datum._unmetNeed = deflate(yr.unmetNeed ?? 0, yr.year);
      datum._unmetNeedNonRetirement = deflate(
        yr.nonRetirementShortfall ?? 0,
        yr.year,
      );
      datum._unmetNeedPenaltyAvoided = deflate(
        yr.penaltyAvoidedShortfall ?? 0,
        yr.year,
      );
      // Guardrail event — the ReferenceLine markers
      // added a visual "▲ raise" flag on the chart but the hover tooltip
      // never carried the underlying detail, so hovering that exact year
      // showed nothing about why it was marked. Threaded through the same
      // way SS/RMD milestones are.
      datum._strategyAction = yr.strategyAction ?? "";
      // "Why was this account used" hover explanation — see
      // formatDiscretionaryTierBreakdown's docblock (utils.ts). Stored as
      // the pre-formatted string (not the raw array) since this datum
      // object otherwise only carries numbers/flags for Recharts' own
      // dataKey lookups.
      datum._discretionaryRoutingNote =
        formatDiscretionaryTierBreakdown(
          yr.discretionaryTierBreakdown?.map((t) => ({
            ...t,
            amount: deflate(t.amount, yr.year),
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
      : ACCT_SEGMENTS.map((s) => ({
          key: s.key,
          hex: s.hex,
          label: s.label,
        }));

  const hasMcData = mcBandsByYear != null;
  const showMc = hasMcData && fanBandRange !== "off";
  const { showBars, showIncome } = state;

  // Decumulation-year income overlay (total portfolio withdrawal + Social
  // Security, secondary axis) — only worth a second axis + legend entry
  // when there's actually decumulation data with a nonzero figure to show;
  // an accumulation-only projection (not yet retired) has no such data.
  const hasIncomeData = chartData.some(
    (d) => Number(d._totalWithdrawal) > 0 || Number(d._ssIncome) > 0,
  );
  const showIncomeOverlay = showIncome && hasIncomeData;

  // Per-strategy spending-adjustment event markers,
  // one per triggering year. Covers every strategy with a real, SPORADIC
  // action worth flagging — Guyton-Klinger's guardrails, and Vanguard
  // Dynamic / Constant % / Endowment's clamp events. RMD-Based and
  // Spending-Decline fire an action every single year (not an event), so
  // they're deliberately excluded — marking every year would be noise, not
  // a signal. Styling/wording factored out to utils.ts so the table
  // tooltip's own guardrail note can't drift
  // from this chart's markers.
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

  // Real, material "the plan called for money it couldn't actually
  // deliver" years — a SEPARATE overlay from
  // guardrailEvents above, deliberately: a guardrail cut and a genuine
  // unmet-need shortfall are orthogonal (a GK cut year can ALSO be a
  // shortfall year), so this can't share guardrailEvents' one-marker-
  // per-year slot without silently dropping whichever fires second.
  // unmetNeedMaterial is the engine's own single canonical verdict — see
  // decumulation-year.ts's docblock for why the raw unmetNeed field alone
  // isn't reliably floor-filtered.
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
          {!mcBandsByYear && mcPrefetchQuery.isFetching && (
            <span className="text-micro ml-2 animate-pulse font-normal text-purple-600 normal-case">
              Simulating...
            </span>
          )}
          {hasMcData && mcIsPrefetch && (
            <span className="text-micro ml-2 font-normal text-purple-600 normal-case">
              Sim. preview
            </span>
          )}
        </h5>
      </div>
      {/* Standalone deterministic shortfall alert — deliberately its own callout, not a badge grafted
          onto the Lifetime Income Stability MC ring (that ring is a
          1000-trial aggregate; this is the single deterministic path
          actually shown in this chart, a different kind of number). */}
      {shortfallEvents.length > 0 && (
        <div className="text-micro mb-2 rounded bg-red-50 px-2 py-1 text-red-600">
          ⚠ {shortfallEvents.length} year
          {shortfallEvents.length === 1 ? "" : "s"} in this deterministic
          projection couldn&apos;t fund the actual spending need — see the
          marked ages below.
        </div>
      )}
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
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
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                const totalBal = segmentKeys.reduce(
                  (s, k) => s + (Number(d[k.key]) || 0),
                  0,
                );
                // "Was the RMD satisfied" status
                // for the RMD line(s) below. A shortfall breaks the amber
                // color family entirely since it's the only state with real
                // IRS excise-tax consequences. Otherwise show a checkmark
                // whenever the RMD was actually met — not just the
                // "eventful" excess/QCD case — since silence alone wasn't a
                // reliable enough signal of "satisfied".
                const rmdShortfall = Number(d._rmdShortfallAmount) > 0;
                const rmdSatisfiedNotably = !rmdShortfall;
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
                        {formatCurrency(totalBal)}
                      </span>
                    </div>
                    {hasMcData && d.mc_p50 != null && (
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
                        <span>Plan return</span>
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
                        {/* Real IRS exposure — the only RMD-related
                            state that earns its own extra line, since it's
                            the only one with actual tax-penalty
                            consequences. Deliberately breaks the amber
                            RMD/QCD color family above (red, not amber) to
                            read as an alarm rather than routine detail. */}
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
                        {/* RMD-forced excess — real money forced out
                            by the RMD floor beyond what the strategy
                            needed, with no prior UI trace anywhere. Can
                            recur every year once RMDs start, unlike the
                            one-time "RMDs begin" milestone above. Wording
                            (not just the amount) depends on the
                            household's rmdExcessHandling setting — nothing
                            was actually reinvested under "spend". */}
                        {Number(d._rmdExcessAmount) > 0 && (
                          <div
                            className={`flex justify-between gap-4 ${tipColorClass.amber}/70 text-caption`}
                          >
                            <span>
                              {engineSettings?.rmdExcessHandling === "spend"
                                ? "RMD excess spent"
                                : "RMD excess reinvested"}
                            </span>
                            <span className="tabular-nums">
                              {engineSettings?.rmdExcessHandling === "spend"
                                ? ""
                                : "+"}
                              {formatCurrency(Number(d._rmdExcessAmount))}
                            </span>
                          </div>
                        )}
                        {/* QCD — money sent directly to charity,
                            satisfying part of the RMD tax-free. Shown
                            separately from "RMD" above since it's the
                            portion that never became taxable income. */}
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
                    {(() => {
                      const eventStyle =
                        typeof d._strategyAction === "string"
                          ? STRATEGY_EVENT_STYLE[d._strategyAction]
                          : undefined;
                      if (!eventStyle) return null;
                      return (
                        <div
                          className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-1 font-medium"
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
                    fill={CHART_COLORS.mcBandOuter}
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
                    fill={CHART_COLORS.mcBandInner}
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
                  fill={CHART_COLORS.mcBandMiddle}
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
                    fill={CHART_COLORS.mcBandInner}
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

            {/* Decumulation-year income overlay: total portfolio withdrawal
                + Social Security, secondary right-hand axis. Two separate
                lines (not stacked into one "total") — SS and withdrawal are
                drawn from genuinely different sources (guaranteed income vs.
                the portfolio itself) and stacking them would imply a single
                combined figure without a clean name; showing each real,
                strategy-computed number lets a household see both "what am
                I living on" and "how much of that is SS" without inventing
                a third derived quantity. */}
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
            {showMc && (
              <Line
                type="monotone"
                yAxisId="balance"
                dataKey="mc_p50"
                stroke={c.mcMedian}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                isAnimationActive={false}
              />
            )}

            {/* Retirement age reference line */}
            {(() => {
              const retDataIdx = chartData.findIndex(
                (d) => Number(d.year) === retYear,
              );
              if (retDataIdx < 0) return null;
              return (
                <Line
                  type="monotone"
                  yAxisId="balance"
                  dataKey={() => undefined}
                  stroke="transparent"
                  dot={false}
                  isAnimationActive={false}
                  label={false}
                />
              );
            })()}

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

            {/* Guyton-Klinger guardrail event markers — a
                household running Guardrails could previously only see
                which years triggered a raise/cut via the table-row
                tooltip; now visible at a glance on the chart too. */}
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

            {/* Real, material unmet-need shortfall markers — a SEPARATE
                overlay from the guardrail-event markers above (see
                shortfallEvents' docblock); deliberately its own darker red
                so it reads as a genuine "couldn't fund it" alarm, not
                another guardrail-style informational marker. */}
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
        </ResponsiveContainer>
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
        {hasMcData && (
          <>
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-3 rounded"
                style={{ backgroundColor: c.mcMedian }}
              />{" "}
              Sim. median
              {mcIsPrefetch && (
                <span className="text-faint ml-0.5">(preview)</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-3 rounded"
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
                  className="h-1.5 w-3 rounded"
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
