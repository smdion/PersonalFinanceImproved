"use client";

import { Toggle } from "@/components/ui/toggle";
import { HelpTip } from "@/components/ui/help-tip";
import { SlidePanel } from "@/components/ui/slide-panel";
import { MethodologyContent } from "@/components/methodology-content";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";
import { DecumulationMethodologyContent } from "@/components/decumulation-methodology-content";
import { ValidationContent } from "@/components/validation-content";
import { taxTypeLabel } from "@/lib/utils/colors";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { EngineYearProjection } from "@/lib/calculators/types";
import {
  SimulationAssumptions,
} from "@/components/cards/mc-simulation-assumptions";
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
import { DecumulationConfig } from "./decumulation-config";
import { OverridesPanel } from "./overrides-panel";
import { ProjectionTable } from "./projection-table";
import { useProjectionState, type EngineContribRate } from "./use-projection-state";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export { type EngineContribRate } from "./use-projection-state";

export function ProjectionCard(props: {
  people?: { id: number; name: string; birthYear: number }[];
  onContributionRates?: (rates: EngineContribRate[]) => void;
  withdrawalRate: number;
  accumulationBudgetProfileId?: number;
  accumulationBudgetColumn?: number;
  accumulationExpenseOverride?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
  parentCategoryFilter?: string;
  contributionProfileId?: number;
  snapshotId?: number;
}) {
  const s = useProjectionState({
    people: props.people,
    onContributionRates: props.onContributionRates,
    withdrawalRate: props.withdrawalRate,
    accumulationBudgetProfileId: props.accumulationBudgetProfileId,
    accumulationBudgetColumn: props.accumulationBudgetColumn,
    accumulationExpenseOverride: props.accumulationExpenseOverride,
    decumulationBudgetProfileId: props.decumulationBudgetProfileId,
    decumulationBudgetColumn: props.decumulationBudgetColumn,
    decumulationExpenseOverride: props.decumulationExpenseOverride,
    parentCategoryFilter: props.parentCategoryFilter,
    contributionProfileId: props.contributionProfileId,
    snapshotId: props.snapshotId,
  });

  // Destructure everything flat — identical variable names as before the hook extraction.
  // This ensures zero changes in the render section below.
  const {
    withdrawalRoutingMode, setWithdrawalRoutingMode,
    withdrawalOrder, setWithdrawalOrder,
    withdrawalSplits, setWithdrawalSplits,
    withdrawalTaxPref, setWithdrawalTaxPref,
    projectionMode, setProjectionMode,
    mcTrials, setMcTrials,
    mcPreset, setMcPreset,
    mcTaxMode, setMcTaxMode,
    mcAssetClassOverrides, setMcAssetClassOverrides,
    dollarMode, setDollarMode,
    balanceView, setBalanceView,
    contribView, setContribView,
    showAllYears, setShowAllYears,
    fanBandRange, setFanBandRange,
    showMethodology, setShowMethodology,
    showAccumMethodology, setShowAccumMethodology,
    showDecumMethodology, setShowDecumMethodology,
    showValidation, setShowValidation,
    showAssumptions, setShowAssumptions,
    showDecumConfig, setShowDecumConfig,
    personFilter, setPersonFilter,
    isPersonFiltered,
    updateGlidePath, updateInflationRisk, updateClampBounds,
    updateAssetClassOverrides, updateInflationOverrides,
    engineQuery, mcPrefetchQuery, mcQuery,
    personFilterName,
    mcLoading, mcBandsByYear, mcIsPrefetch, mcChartPending,
    result,
    enginePeople,
    engineSettings,
    getPersonYearTotals, personDepletionInfo,
    visibleColumns, columnLabel,
    baseYear, deflate,
  } = s;

  // Props forwarded for render-section access
  const {
    parentCategoryFilter, people,
    accumulationBudgetProfileId, accumulationBudgetColumn,
    accumulationExpenseOverride,
    decumulationBudgetProfileId, decumulationBudgetColumn,
    decumulationExpenseOverride,
  } = props;

  return (
    <>
      <div className="space-y-6 mb-6">
        <div className="space-y-6">
          {/* ================================================================= */}
          {/* RESULTS */}
          {/* ================================================================= */}
          {engineQuery.isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg
                className="animate-spin h-6 w-6 text-blue-500"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <div className="text-sm text-muted font-medium">
                Running projection engine...
              </div>
              {mcPrefetchQuery.isFetching && (
                <div className="text-[10px] text-purple-400">
                  + Monte Carlo background (1K trials)
                </div>
              )}
            </div>
          )}

          {engineQuery.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Failed to run engine: {engineQuery.error.message}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Hero KPIs — MC-adaptive */}
              {(() => {
                const retYear = result.projectionByYear.find(
                  (yr) => yr.age === engineSettings?.retirementAge,
                );
                const retPt = retYear ? getPersonYearTotals(retYear) : null;
                const nestEgg = retYear
                  ? deflate(
                      retPt ? retPt.balance : retYear.endBalance,
                      retYear.year,
                    )
                  : 0;
                const peakYear = result.projectionByYear.reduce((best, yr) => {
                  const yrB = getPersonYearTotals(yr)?.balance ?? yr.endBalance;
                  const bestB =
                    getPersonYearTotals(best)?.balance ?? best.endBalance;
                  return deflate(yrB, yr.year) > deflate(bestB, best.year)
                    ? yr
                    : best;
                });
                const peakPt = getPersonYearTotals(peakYear);
                const peakBalance = deflate(
                  peakPt ? peakPt.balance : peakYear.endBalance,
                  peakYear.year,
                );
                const mc =
                  mcQuery.data?.result && !mcLoading
                    ? mcQuery.data.result
                    : null;
                const mcBands = mc?.percentileBands ?? null;
                const mcRetBand = mcBands?.find(
                  (b) => b.age === engineSettings?.retirementAge,
                );
                const terminalYear =
                  baseYear +
                  (engineSettings!.endAge -
                    (result.projectionByYear[0]?.age ?? 0));
                const depl = isPersonFiltered
                  ? personDepletionInfo
                  : result.portfolioDepletionAge
                    ? {
                        age: result.portfolioDepletionAge,
                        year: result.portfolioDepletionYear,
                      }
                    : null;

                if (mc) {
                  // MC-primary hero
                  const pct = Math.round(mc.successRate * 100);
                  const gaugeColor =
                    pct >= 90
                      ? "text-green-600"
                      : pct >= 75
                        ? "text-yellow-600"
                        : pct >= 50
                          ? "text-orange-500"
                          : "text-red-600";
                  const gaugeBg =
                    pct >= 90
                      ? "bg-green-50"
                      : pct >= 75
                        ? "bg-yellow-50"
                        : pct >= 50
                          ? "bg-orange-50"
                          : "bg-red-50";
                  const gaugeRing =
                    pct >= 90
                      ? "stroke-green-500"
                      : pct >= 75
                        ? "stroke-yellow-500"
                        : pct >= 50
                          ? "stroke-orange-500"
                          : "stroke-red-500";
                  const circumference = 2 * Math.PI * 40;
                  const dashOffset = circumference * (1 - mc.successRate);

                  return (
                    <div className="grid grid-cols-3 gap-4">
                      {/* Card 1: Success Rate gauge */}
                      <div
                        className={`${gaugeBg} rounded-lg p-4 flex flex-col items-center justify-center`}
                      >
                        <div className="relative w-20 h-20">
                          <svg
                            className="w-20 h-20 -rotate-90"
                            viewBox="0 0 100 100"
                          >
                            <circle
                              cx="50"
                              cy="50"
                              r="40"
                              fill="none"
                              strokeWidth="8"
                              className="stroke-gray-200"
                            />
                            <circle
                              cx="50"
                              cy="50"
                              r="40"
                              fill="none"
                              strokeWidth="8"
                              className={gaugeRing}
                              strokeLinecap="round"
                              strokeDasharray={circumference}
                              strokeDashoffset={dashOffset}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-xl font-bold ${gaugeColor}`}>
                              {pct}%
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-muted mt-1 text-center">
                          Success Rate
                          <HelpTip text="Percentage of simulated scenarios where your money lasts through your full projection." />
                        </div>
                        <div className="text-[10px] text-faint mt-0.5">
                          Det: {depl ? `Age ${depl.age}` : "Lasts \u2713"}
                        </div>
                      </div>

                      {/* Card 2: Nest Egg (MC primary) */}
                      <div className="bg-purple-50 rounded-lg p-4 text-center">
                        <div className="text-xs text-purple-600 uppercase font-medium">
                          {isPersonFiltered
                            ? `${personFilterName}'s Nest Egg`
                            : "Nest Egg at Retirement"}
                        </div>
                        <div className="text-2xl font-bold text-purple-700">
                          {mcRetBand
                            ? formatCurrency(
                                deflate(mcRetBand.p50, mcRetBand.year),
                              )
                            : formatCurrency(nestEgg)}
                        </div>
                        {mcRetBand && (
                          <div className="text-[10px] text-purple-400">
                            Range{""}
                            {formatCurrency(
                              deflate(mcRetBand.p25, mcRetBand.year),
                            )}
                            {""}–{""}
                            {formatCurrency(
                              deflate(mcRetBand.p75, mcRetBand.year),
                            )}
                          </div>
                        )}
                        <div className="text-[10px] text-faint mt-0.5">
                          Det: {formatCurrency(nestEgg)}
                        </div>
                      </div>

                      {/* Card 3: Funding Outlook */}
                      <div className="bg-surface-sunken rounded-lg p-4 text-center">
                        <div className="text-xs text-muted uppercase font-medium">
                          Funding Outlook
                        </div>
                        <div className="text-lg font-bold text-primary">
                          {mc.distributions.depletionAge
                            ? `${Math.round((1 - mc.successRate) * 100)}% risk`
                            : "Fully Funded"}
                        </div>
                        <div className="text-[10px] text-muted">
                          {mc.distributions.depletionAge
                            ? `Median depletion age ${Math.round(mc.distributions.depletionAge.median)}`
                            : `Money lasts in ${pct}% of futures`}
                        </div>
                        <div className="text-[10px] text-faint mt-0.5">
                          MC end bal:{""}
                          {formatCurrency(
                            deflate(mc.medianEndBalance, terminalYear),
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Deterministic hero (no MC)
                return (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-emerald-50 rounded-lg p-4 text-center">
                      <div className="text-xs text-emerald-600 uppercase font-medium">
                        {isPersonFiltered
                          ? `${personFilterName}'s Nest Egg`
                          : "Nest Egg at Retirement"}
                      </div>
                      <div className="text-2xl font-bold text-emerald-700">
                        {formatCurrency(nestEgg)}
                      </div>
                      <div className="text-[10px] text-emerald-500">
                        Avg age {engineSettings?.retirementAge ?? "?"}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <div className="text-xs text-blue-600 uppercase font-medium">
                        {isPersonFiltered
                          ? `${personFilterName}'s Peak`
                          : "Peak Balance"}
                      </div>
                      <div className="text-2xl font-bold text-blue-700">
                        {formatCurrency(peakBalance)}
                      </div>
                      <div className="text-[10px] text-blue-500">
                        Maximum projected balance
                      </div>
                    </div>
                    <div className="bg-surface-sunken rounded-lg p-4 text-center">
                      <div className="text-xs text-muted uppercase font-medium">
                        {isPersonFiltered
                          ? `${personFilterName}'s Funding`
                          : "Funding Duration"}
                      </div>
                      <div className="text-2xl font-bold">
                        {depl ? `Age ${depl.age}` : "Lasts \u2713"}
                      </div>
                      <div className="text-[10px] text-faint">
                        {depl
                          ? `Runs out ${depl.year}`
                          : `Through age ${engineSettings?.endAge ?? "?"}`}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* MC depletion callout (compact 1-liner) */}
              {mcQuery.data?.result &&
                !mcLoading &&
                mcQuery.data.result.distributions.depletionAge &&
                (() => {
                  const mc = mcQuery.data.result;
                  const terminalYear =
                    baseYear +
                    (engineSettings!.endAge -
                      (result.projectionByYear[0]?.age ?? 0));
                  const tb = mc.distributions.terminalBalance;
                  const deplPct = Math.round((1 - mc.successRate) * 100);
                  const isLowRisk = mc.successRate >= 0.9;
                  return (
                    <div
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${isLowRisk ? "bg-surface-elevated text-muted" : "bg-red-50 text-red-700"}`}
                    >
                      <span className="font-medium shrink-0">
                        {isLowRisk ? "\u2139\uFE0F" : "\u26A0"}
                        {""}
                        {isLowRisk
                          ? `In rare scenarios (${deplPct}%), money runs out around age ${Math.round(mc.distributions.depletionAge!.median)}.`
                          : `In ${deplPct}% of futures, money runs out around age ${Math.round(mc.distributions.depletionAge!.median)}.`}
                      </span>
                      <span
                        className={isLowRisk ? "text-muted" : "text-red-600"}
                      >
                        Typical end balance:{""}
                        {formatCurrency(deflate(tb.median, terminalYear))}
                      </span>
                      <HelpTip
                        maxWidth={400}
                        lines={[
                          "Terminal balance distribution (today\u2019s dollars):",
                          `Bad luck (p10): ${formatCurrency(deflate(tb.p10, terminalYear))}`,
                          `Below avg (p25): ${formatCurrency(deflate(tb.p25, terminalYear))}`,
                          `Typical (p50): ${formatCurrency(deflate(tb.median, terminalYear))}`,
                          `Above avg (p75): ${formatCurrency(deflate(tb.p75, terminalYear))}`,
                          `Good luck (p90): ${formatCurrency(deflate(tb.p90, terminalYear))}`,
                          isLowRisk
                            ? "Only a small fraction of simulated scenarios show depletion — this is within normal planning margins."
                            : "A bad stretch of returns early in retirement can drain your portfolio before it recovers.",
                        ]}
                      />
                    </div>
                  );
                })()}

              {/* Compact deterministic stats row */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-4 py-2.5 bg-surface-sunken text-xs">
                {mcQuery.data?.result && !mcLoading && (
                  <span className="text-[10px] font-medium text-faint uppercase tracking-wide mr-1">
                    Deterministic
                    <HelpTip text="Single-path projection using fixed average returns. Compare with Monte Carlo which simulates thousands of randomized return sequences." />
                  </span>
                )}
                {(() => {
                  const mcMedianPV =
                    mcPrefetchQuery.data?.result?.distributions
                      ?.sustainableWithdrawalPV?.median;
                  const hasMc = mcMedianPV != null && mcMedianPV > 0;
                  const detValue = deflate(
                    result.sustainableWithdrawal,
                    baseYear +
                      (engineSettings!.retirementAge -
                        (result.projectionByYear[0]?.age ?? 0)),
                  );
                  return (
                    <div>
                      <span className="text-muted">
                        {isPersonFiltered
                          ? `${personFilterName}'s Withdrawal`
                          : "Withdrawal"}
                        <HelpTip
                          text={
                            hasMc
                              ? "The median annual withdrawal across thousands of simulated market scenarios, in today's dollars. Half of simulations supported more than this amount, half supported less. Accounts for market volatility, tax impacts, and sequence-of-returns risk."
                              : "Estimated annual withdrawal calculated as your projected nest egg × withdrawal rate, assuming constant average returns. Does not account for market volatility or taxes."
                          }
                        />
                        :{""}
                      </span>
                      <span className="font-semibold text-green-700">
                        {formatCurrency(hasMc ? mcMedianPV : detValue)}
                      </span>
                      <span className="text-faint">/yr</span>
                    </div>
                  );
                })()}
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">Depletion: </span>
                  <span className="font-semibold">
                    {(() => {
                      const depl = isPersonFiltered
                        ? personDepletionInfo
                        : result.portfolioDepletionAge
                          ? { age: result.portfolioDepletionAge }
                          : null;
                      return depl ? `Age ${depl.age}` : "Never";
                    })()}
                  </span>
                </div>
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">Overflow: </span>
                  <span className="font-semibold">
                    {result.firstOverflowAge
                      ? `Age ${result.firstOverflowAge}`
                      : "None"}
                  </span>
                  <HelpTip text="The first year your contributions exceed IRS limits for tax-advantaged accounts (401k, HSA, IRA). The excess spills into your taxable brokerage account." />
                </div>
                <div className="w-px h-4 bg-surface-strong" />
                <div>
                  <span className="text-muted">End Balance: </span>
                  <span className="font-semibold">
                    {(() => {
                      if (result.projectionByYear.length === 0) return "$0";
                      const last =
                        result.projectionByYear[
                          result.projectionByYear.length - 1
                        ]!;
                      const lastPt = getPersonYearTotals(last);
                      return formatCurrency(
                        deflate(
                          lastPt ? lastPt.balance : last.endBalance,
                          last.year,
                        ),
                      );
                    })()}
                  </span>
                  <span className="text-faint ml-1">
                    age{""}
                    {result.projectionByYear.length > 0
                      ? result.projectionByYear[
                          result.projectionByYear.length - 1
                        ]!.age
                      : "?"}
                  </span>
                </div>
              </div>

              {/* Unified toolbar — two rows */}
              {(() => {
                const pillBtn = (
                  active: boolean,
                  onClick: () => void,
                  label: string,
                ) => (
                  <button
                    type="button"
                    onClick={onClick}
                    className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                      active
                        ? "bg-surface-primary text-primary shadow-sm border"
                        : "text-muted hover:text-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
                const pp = people ?? enginePeople;
                const isMc = projectionMode === "monteCarlo";
                return (
                  <div className="bg-surface-sunken rounded-lg px-3 py-2 space-y-1.5">
                    {/* Row 1: VIEW | PROJECTION | DOLLARS */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {/* Person filter */}
                      {pp && pp.length > 1 && (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-faint font-medium uppercase">
                              View
                            </span>
                            <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                              {pillBtn(
                                personFilter === "all",
                                () => setPersonFilter("all"),
                                "Joint",
                              )}
                              {pp.map((p) =>
                                pillBtn(
                                  personFilter === p.id,
                                  () => setPersonFilter(p.id),
                                  p.name,
                                ),
                              )}
                            </div>
                          </div>
                          <div className="w-px h-4 bg-surface-strong" />
                        </>
                      )}
                      {/* Projection mode — binary toggle + preset dropdown */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Projection
                          <HelpTip
                            maxWidth={420}
                            lines={[
                              <span key="det">
                                <strong className="text-blue-300">
                                  Deterministic
                                </strong>
                                {""}— Single fixed-rate projection using your
                                configured return rates. Shows one possible
                                future, no randomness.
                              </span>,
                              <span key="agg">
                                <strong className="text-red-300">
                                  Aggressive
                                </strong>
                                {""}— Full historical returns, 0.9× vol, high
                                equity (95%→35%). Money Guy / Bogleheads
                                &quot;age - 20&quot; bonds rule.
                              </span>,
                              <span key="def">
                                <strong className="text-green-300">
                                  Default
                                </strong>
                                {""}— Historical returns, standard vol, hybrid
                                FIRE glide path (90%→50% floor). Vanguard TDF
                                accumulation + Kitces rising equity.
                              </span>,
                              <span key="con">
                                <strong className="text-amber-300">
                                  Conservative
                                </strong>
                                {""}— Forward-looking returns (~5% equity), +15%
                                vol, heavy bonds (75%→15%). Vanguard VCMM / JP
                                Morgan LTCMA.
                              </span>,
                              <span key="cus">
                                <strong className="text-purple-300">
                                  Custom
                                </strong>
                                {""}— Raw DB values for returns, volatility, and
                                glide path. No preset adjustments — edit
                                asset_class_params and glide_path_allocations
                                directly.
                              </span>,
                            ]}
                          />
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            !isMc,
                            () => setProjectionMode("deterministic"),
                            "Deterministic",
                          )}
                          {pillBtn(
                            isMc,
                            () => setProjectionMode("monteCarlo"),
                            "Monte Carlo",
                          )}
                        </div>
                        {isMc && (
                          <>
                            <select
                              value={mcPreset}
                              onChange={(e) =>
                                setMcPreset(e.target.value as typeof mcPreset)
                              }
                              className="text-[10px] h-6 px-1.5 rounded border bg-surface-primary text-muted cursor-pointer"
                              title="MC preset scenario"
                            >
                              <option value="aggressive">Aggressive</option>
                              <option value="default">Default</option>
                              <option value="conservative">Conservative</option>
                              <option value="custom">Custom</option>
                            </select>
                            <select
                              value={mcTrials}
                              onChange={(e) =>
                                setMcTrials(Number(e.target.value))
                              }
                              className="text-[10px] h-6 px-1.5 rounded border bg-surface-primary text-muted cursor-pointer"
                              title="Number of simulation trials"
                            >
                              <option value={500}>500 trials</option>
                              <option value={1000}>1,000 trials</option>
                              <option value={2500}>2,500 trials</option>
                              <option value={5000}>5,000 trials</option>
                            </select>
                            <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                              {pillBtn(
                                mcTaxMode === "simple",
                                () => setMcTaxMode("simple"),
                                "Simple",
                              )}
                              {pillBtn(
                                mcTaxMode === "advanced",
                                () => setMcTaxMode("advanced"),
                                "Advanced",
                              )}
                            </div>
                            <HelpTip
                              maxWidth={360}
                              lines={[
                                <span key="simple">
                                  <strong className="text-blue-300">
                                    Simple
                                  </strong>
                                  {""}— Single portfolio, no tax. Comparable to
                                  cFIREsim/FireCalc.
                                </span>,
                                <span key="advanced">
                                  <strong className="text-orange-300">
                                    Advanced
                                  </strong>
                                  {""}— Full multi-account tax-aware simulation
                                  with gross-up and bracket filling.
                                </span>,
                              ]}
                            />
                            <button
                              type="button"
                              onClick={() => setShowMethodology(true)}
                              className="text-[10px] text-blue-500 hover:text-blue-600 underline whitespace-nowrap"
                            >
                              How does this work?
                            </button>
                          </>
                        )}
                      </div>
                      <div className="w-px h-4 bg-surface-strong" />
                      {/* Dollar mode — Today's $ first */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Dollars
                          <HelpTip
                            maxWidth={400}
                            lines={[
                              <div key="today" className="space-y-1">
                                <div>
                                  <strong className="text-blue-300">
                                    Today&apos;s $
                                  </strong>
                                  {""}
                                  <span className="text-faint">(default)</span>
                                </div>
                                <div className="text-faint text-xs">
                                  Removes inflation — every dollar means the
                                  same as it does right now. A $100k balance in
                                  2050 shows what that money actually buys
                                  today.
                                </div>
                                <div className="text-xs text-faint mt-0.5">
                                  Use when:
                                </div>
                                <ul
                                  className="text-xs text-faint ml-3 space-y-0.5"
                                  style={{ listStyleType: "'▸ '" }}
                                >
                                  <li>
                                    <span className="text-blue-300/80">
                                      Will I have enough to retire?
                                    </span>
                                  </li>
                                  <li>
                                    Comparing your nest egg to your{""}
                                    <em>current</em> salary
                                  </li>
                                  <li>
                                    Checking if withdrawals cover today&apos;s
                                    expenses
                                  </li>
                                  <li>
                                    Evaluating whether savings rate keeps up
                                  </li>
                                  <li>Comparing scenarios across decades</li>
                                </ul>
                                <div className="text-[10px] text-muted italic mt-0.5">
                                  Salary and withdrawals may appear flat or
                                  declining — that&apos;s not a bug, it means
                                  purchasing power isn&apos;t outpacing
                                  inflation.
                                </div>
                              </div>,
                              <div
                                key="future"
                                className="space-y-1 border-t pt-1.5"
                              >
                                <div>
                                  <strong className="text-green-300">
                                    Future $
                                  </strong>
                                </div>
                                <div className="text-faint text-xs">
                                  Actual dollar amounts as they&apos;ll appear
                                  on statements, tax forms, and paychecks.
                                  Numbers grow larger because they include
                                  inflation.
                                </div>
                                <div className="text-xs text-faint mt-0.5">
                                  Use when:
                                </div>
                                <ul
                                  className="text-xs text-faint ml-3 space-y-0.5"
                                  style={{ listStyleType: "'▸ '" }}
                                >
                                  <li>
                                    Checking if you&apos;ll hit{""}
                                    <span className="text-green-300/80">
                                      401k/IRA contribution limits
                                    </span>
                                  </li>
                                  <li>
                                    Planning{""}
                                    <span className="text-green-300/80">
                                      Roth conversions
                                    </span>
                                    {""}
                                    against tax brackets
                                  </li>
                                  <li>
                                    Estimating{""}
                                    <span className="text-green-300/80">
                                      RMD amounts
                                    </span>
                                  </li>
                                  <li>
                                    Seeing what your account balance will
                                    actually read
                                  </li>
                                  <li>
                                    Modeling{""}
                                    <span className="text-green-300/80">
                                      IRMAA thresholds
                                    </span>
                                  </li>
                                  <li>Filing-year tax projections</li>
                                </ul>
                              </div>,
                              <div
                                key="tip"
                                className="border-t pt-1.5 text-xs text-faint italic"
                              >
                                Same projection, different lens.{""}
                                <span className="text-blue-300">
                                  Today&apos;s $
                                </span>
                                {""}
                                answers{""}
                                <strong className="text-faint">
                                  &quot;is this enough?&quot;
                                </strong>
                                {""}—{""}
                                <span className="text-green-300">Future $</span>
                                {""}
                                answers{""}
                                <strong className="text-faint">
                                  &quot;what will the statement say?&quot;
                                </strong>
                              </div>,
                            ]}
                          />
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            dollarMode === "real",
                            () => setDollarMode("real"),
                            "Today's $",
                          )}
                          {pillBtn(
                            dollarMode === "nominal",
                            () => setDollarMode("nominal"),
                            "Future $",
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Row 2: CONTRIBUTIONS | BALANCES | FAN BANDS | ALL YEARS */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-1.5">
                      {/* Contribution grouping */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Contributions
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            contribView === "account",
                            () => setContribView("account"),
                            "Account",
                          )}
                          {pillBtn(
                            contribView === "taxType",
                            () => setContribView("taxType"),
                            "Tax Type",
                          )}
                        </div>
                      </div>
                      <div className="w-px h-4 bg-surface-strong" />
                      {/* Balance grouping */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-faint font-medium uppercase">
                          Balances
                        </span>
                        <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                          {pillBtn(
                            balanceView === "taxType",
                            () => setBalanceView("taxType"),
                            "Tax Type",
                          )}
                          {pillBtn(
                            balanceView === "account",
                            () => setBalanceView("account"),
                            "Account",
                          )}
                        </div>
                      </div>
                      {/* Fan band range — only when MC data present */}
                      {mcBandsByYear != null && (
                        <>
                          <div className="w-px h-4 bg-surface-strong" />
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-faint font-medium uppercase">
                              Fan Bands
                              <HelpTip
                                maxWidth={360}
                                lines={[
                                  "The shaded fan on the chart shows the spread of Monte Carlo outcomes across all simulated trials.",
                                  <span key="p25">
                                    <strong className="text-purple-300">
                                      p25-p75
                                    </strong>
                                    {""}— Middle 50% of outcomes. Tightest view,
                                    shows the most likely range.
                                  </span>,
                                  <span key="p10">
                                    <strong className="text-purple-300">
                                      p10-p90
                                    </strong>
                                    {""}— Middle 80% of outcomes. Wider view,
                                    includes moderately good and bad luck.
                                  </span>,
                                  <span key="p5">
                                    <strong className="text-purple-300">
                                      p5-p95
                                    </strong>
                                    {""}— Middle 90% of outcomes. Widest view,
                                    can stretch the Y-axis significantly.
                                  </span>,
                                ]}
                              />
                            </span>
                            <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5">
                              {pillBtn(
                                fanBandRange === "p25-p75",
                                () => setFanBandRange("p25-p75"),
                                "p25–p75",
                              )}
                              {pillBtn(
                                fanBandRange === "p10-p90",
                                () => setFanBandRange("p10-p90"),
                                "p10–p90",
                              )}
                              {pillBtn(
                                fanBandRange === "p5-p95",
                                () => setFanBandRange("p5-p95"),
                                "p5–p95",
                              )}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="w-px h-4 bg-surface-strong" />
                      {/* Year density */}
                      <Toggle
                        label="All years"
                        checked={showAllYears}
                        onChange={setShowAllYears}
                        size="xs"
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Visual Balance Projection — ComposedChart */}
              {mcChartPending && (
                <div className="bg-surface-sunken rounded-lg p-3">
                  <h5 className="text-xs font-medium text-muted uppercase mb-2">
                    Balance Projection
                    <span className="text-[9px] text-purple-400 animate-pulse ml-2 normal-case font-normal">
                      Running simulation...
                    </span>
                  </h5>
                  <div className="h-[320px] relative overflow-hidden">
                    {/* Skeleton bar chart */}
                    <div className="absolute inset-0 flex items-end gap-1.5 px-8 pb-8 pt-4">
                      {[
                        18, 24, 30, 38, 46, 55, 62, 70, 78, 84, 88, 92, 95, 90,
                        85, 80, 74, 68, 60, 52, 44, 36, 28, 20,
                      ].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t bg-surface-strong animate-pulse"
                          style={{
                            height: `${h}%`,
                            animationDelay: `${i * 60}ms`,
                          }}
                        />
                      ))}
                    </div>
                    {/* Skeleton fan overlay */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-xs text-faint bg-surface-sunken/80 px-3 py-1.5 rounded-full animate-pulse">
                        Simulating 1,000 scenarios...
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {!mcChartPending &&
                (() => {
                  // Bars always show standalone deterministic projection.
                  // MC fan bands + median line overlay on top via mcBandsByYear.
                  const years = result.projectionByYear;
                  const retAge = engineSettings!.retirementAge;
                  // Show every other year + retirement year for compactness
                  const retIdx = years.findIndex((y) => y.age === retAge);
                  const filtered = years.filter(
                    (_, i) => i % 2 === 0 || i === retIdx,
                  );

                  // Hex colors for Recharts (can't use Tailwind classes)
                  const TAX_HEX: Record<string, string> = {
                    preTax: "#3b82f6", // blue-500
                    taxFree: "#8b5cf6", // violet-500
                    hsa: "#10b981", // emerald-500
                    afterTax: "#f97316", // orange-500
                  };
                  const TAX_KEYS = (
                    ["preTax", "taxFree", "hsa", "afterTax"] as const
                  ).filter((t) => visibleColumns.balanceTaxTypes.has(t));

                  // Account-level chart segments
                  const ACCT_SEGMENTS = getAccountSegments()
                    .map((seg) => ({
                      key: seg.key,
                      hex:
                        seg.subKey === "roth"
                          ? seg.category === "401k"
                            ? "#93c5fd"
                            : seg.category === "ira"
                              ? "#c4b5fd"
                              : seg.category === "hsa"
                                ? "#6ee7b7"
                                : seg.category === "brokerage"
                                  ? "#fdba74"
                                  : "#9ca3af"
                          : seg.category === "401k"
                            ? "#3b82f6"
                            : seg.category === "ira"
                              ? "#8b5cf6"
                              : seg.category === "hsa"
                                ? "#10b981"
                                : seg.category === "brokerage"
                                  ? "#f97316"
                                  : "#6b7280",
                      label: columnLabel[seg.key] ?? seg.label,
                      get: (yr: EngineYearProjection) =>
                        getSegmentBalance(yr.balanceByAccount, seg),
                    }))
                    .filter((seg) => visibleColumns.balanceAccts.has(seg.key));

                  // Build chart data
                  const chartData = filtered.map((yr) => {
                    const pt = getPersonYearTotals(yr);
                    const nomBal = pt ? pt.balance : yr.endBalance;
                    const _total = nomBal || 1;
                    const band = mcBandsByYear?.get(yr.year);

                    const datum: Record<string, number | string> = {
                      age: yr.age,
                      year: yr.year,
                    };

                    // Tax-type or account segment values (deflated)
                    if (balanceView === "taxType") {
                      for (const key of TAX_KEYS) {
                        const val = pt
                          ? pt.byTaxType[key]
                          : yr.balanceByTaxType[key];
                        datum[key] = Math.max(0, deflate(val, yr.year));
                      }
                    } else {
                      for (const seg of ACCT_SEGMENTS) {
                        const val = pt
                          ? (pt.byAccount[seg.key] ?? 0)
                          : seg.get(yr);
                        datum[seg.key] = Math.max(0, deflate(val, yr.year));
                      }
                    }

                    // MC percentile band areas (stacked deltas for Area components)
                    if (band) {
                      const dp5 = deflate(band.p5, yr.year);
                      const dp10 = deflate(band.p10, yr.year);
                      const dp25 = deflate(band.p25, yr.year);
                      const dp50 = deflate(band.p50, yr.year);
                      const dp75 = deflate(band.p75, yr.year);
                      const dp90 = deflate(band.p90, yr.year);
                      const dp95 = deflate(band.p95, yr.year);
                      // Store raw percentiles for tooltip use
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
                        // p25-p75 — tightest band
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
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#e5e7eb"
                            />
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
                                      .filter(
                                        (k) => (Number(d[k.key]) || 0) > 0,
                                      )
                                      .map((k) => (
                                        <div
                                          key={k.key}
                                          className="flex justify-between gap-4"
                                        >
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
                                radius={
                                  i === segmentKeys.length - 1
                                    ? [2, 2, 0, 0]
                                    : undefined
                                }
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
                          <span
                            key={seg.key}
                            className="flex items-center gap-1"
                          >
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
                                <span className="text-faint ml-0.5">
                                  (preview)
                                </span>
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
                                      fanBandRange === "p5-p95"
                                        ? "#ede9fe"
                                        : "#c4b5fd",
                                    opacity:
                                      fanBandRange === "p5-p95" ? 0.6 : 0.5,
                                  }}
                                />
                                {""}
                                {fanBandRange === "p10-p90"
                                  ? "p10–p90"
                                  : "p5–p95"}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* ============================================================= */}
              {/* MONTE CARLO — Loading, Errors, Warnings, Assumptions */}
              {/* ============================================================= */}
              {projectionMode === "monteCarlo" && (
                <div className="space-y-3">
                  {mcLoading && (
                    <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted">
                      <svg
                        className="animate-spin h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Running {mcTrials.toLocaleString()} simulations (
                      {mcPreset})...
                    </div>
                  )}
                  {mcQuery.error && (
                    <div className="text-sm text-red-500 py-4">
                      Monte Carlo failed: {mcQuery.error.message}
                    </div>
                  )}
                  {mcQuery.data?.result && !mcLoading && (
                    <>
                      {/* MC warnings */}
                      {mcQuery.data.result.warnings.length > 0 && (
                        <div className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                          {mcQuery.data.result.warnings.map((w, i) => (
                            <div key={i}>{w}</div>
                          ))}
                        </div>
                      )}
                      {/* MC compact summary bar */}
                      {mcQuery.data.simulationInputs &&
                        (() => {
                          const si = mcQuery.data.simulationInputs;
                          const mcr = mcQuery.data.result!;
                          const successPct = Math.round(mcr.successRate * 100);
                          const presetBar: Record<
                            string,
                            {
                              bg: string;
                              border: string;
                              pill: string;
                              accent: string;
                            }
                          > = {
                            aggressive: {
                              bg: "bg-red-50/60",
                              border: "border-red-200",
                              pill: "text-white bg-red-500",
                              accent: "text-red-700",
                            },
                            default: {
                              bg: "bg-blue-50/60",
                              border: "border-blue-200",
                              pill: "text-white bg-blue-500",
                              accent: "text-blue-700",
                            },
                            conservative: {
                              bg: "bg-green-50/60",
                              border: "border-green-200",
                              pill: "text-white bg-green-600",
                              accent: "text-green-700",
                            },
                            custom: {
                              bg: "bg-purple-50/60",
                              border: "border-purple-200",
                              pill: "text-white bg-purple-500",
                              accent: "text-purple-700",
                            },
                          };
                          const ps =
                            presetBar[si.preset] ?? presetBar["default"]!;
                          const successColor =
                            successPct >= 90
                              ? "text-green-700"
                              : successPct >= 75
                                ? "text-amber-700"
                                : "text-red-700";
                          return (
                            <div
                              className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-4 py-2.5 ${ps.bg} ${ps.border}`}
                            >
                              <span
                                className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wider text-[10px] shadow-sm ${ps.pill}`}
                              >
                                {si.presetLabel}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-lg font-bold tabular-nums leading-none ${successColor}`}
                                >
                                  {successPct}%
                                </span>
                                <span className="text-[10px] text-muted leading-tight">
                                  success
                                  <br />
                                  rate
                                </span>
                                <HelpTip
                                  maxWidth={420}
                                  lines={[
                                    `Percentage of simulated futures where your money lasted from age ${si.retirementAge} through age ${si.endAge} — a ${si.endAge - si.retirementAge}-year retirement.`,
                                    <span key="ranges" className="space-y-0.5">
                                      <div>
                                        <strong className="text-green-400">
                                          90%+
                                        </strong>
                                        {""}— Strong. Most planners consider
                                        this the target. You can likely sustain
                                        your spending.
                                      </div>
                                      <div>
                                        <strong className="text-amber-400">
                                          75–89%
                                        </strong>
                                        {""}— Moderate. Workable but with
                                        meaningful risk. Consider reducing
                                        spending or working longer.
                                      </div>
                                      <div>
                                        <strong className="text-red-400">
                                          Below 75%
                                        </strong>
                                        {""}— Elevated risk. A significant
                                        portion of futures run out of money.
                                        Review assumptions.
                                      </div>
                                    </span>,
                                    <span key="timeframe">
                                      <strong className="text-blue-300">
                                        Time horizon matters:
                                      </strong>
                                      {""}
                                      The classic 4% rule was tested on 30-year
                                      retirements. Your plan spans{""}
                                      {si.endAge - si.retirementAge} years
                                      {si.endAge - si.retirementAge > 30
                                        ? " — longer than 30 years, which gives bad market sequences more time to compound. Early retirees often need a lower withdrawal rate (3-3.5%) or higher savings to compensate."
                                        : si.endAge - si.retirementAge < 25
                                          ? " — shorter than typical, which works in your favor. Fewer years of withdrawals means less exposure to prolonged downturns."
                                          : " — a typical horizon. The 4% rule research applies well to this range."}
                                    </span>,
                                    `100% is not necessarily the goal — it often means you're underspending or using overly optimistic assumptions. Most financial planners target 85-95% as a realistic sweet spot.`,
                                  ]}
                                />
                              </div>
                              <div className="w-px h-6 bg-gray-300/60" />
                              <div className="flex items-center gap-3 text-xs text-muted">
                                <div className="text-center">
                                  <div className="font-semibold tabular-nums">
                                    {formatPercent(si.blendedReturn, 2)}
                                  </div>
                                  <div className="text-[9px] text-faint">
                                    return
                                  </div>
                                  <div className="text-[8px] text-faint">
                                    5–10%
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="font-semibold tabular-nums">
                                    {formatPercent(si.blendedVol, 2)}
                                  </div>
                                  <div className="text-[9px] text-faint">
                                    volatility
                                  </div>
                                  <div className="text-[8px] text-faint">
                                    8–16%
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="font-semibold tabular-nums">
                                    {formatPercent(si.withdrawalRate, 2)}
                                  </div>
                                  <div className="text-[9px] text-faint">
                                    withdrawal
                                  </div>
                                  <div className="text-[8px] text-faint">
                                    3–4%
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="font-semibold tabular-nums">
                                    {formatPercent(
                                      si.inflationRisk.meanRate,
                                      2,
                                    )}
                                  </div>
                                  <div className="text-[9px] text-faint">
                                    inflation
                                  </div>
                                  <div className="text-[8px] text-faint">
                                    2–3%
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="font-semibold tabular-nums">
                                    {mcr.numTrials.toLocaleString()}
                                  </div>
                                  <div className="text-[9px] text-faint">
                                    trials
                                  </div>
                                  <div className="text-[8px] text-faint">
                                    1K+
                                  </div>
                                </div>
                              </div>
                              {(si.taxMode === "advanced" ||
                                si.hasAssetClassOverrides) && (
                                <>
                                  <div className="w-px h-6 bg-gray-300/60" />
                                  <div className="flex items-center gap-2 text-[10px]">
                                    {si.taxMode === "advanced" && (
                                      <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                                        Tax-aware
                                      </span>
                                    )}
                                    {si.hasAssetClassOverrides && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                        Overrides
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => setShowAssumptions(true)}
                                className={`ml-auto px-3 py-1.5 rounded-md text-[11px] font-semibold border shadow-sm transition-colors ${ps.border} ${ps.accent} hover:bg-surface-primary/80`}
                              >
                                View Assumptions &rarr;
                              </button>
                            </div>
                          );
                        })()}
                    </>
                  )}
                  {!mcQuery.data?.result && !mcLoading && !mcQuery.error && (
                    <div className="text-sm text-muted py-4">
                      No Monte Carlo data available. Ensure asset classes and
                      glide path are configured.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


              {/* ============================================================= */}
              {/* UNIFIED TABLE (Deterministic view) */}
              {/* ============================================================= */}
              <ProjectionTable
                state={s}
                people={people}
                parentCategoryFilter={parentCategoryFilter}
                accumulationBudgetProfileId={accumulationBudgetProfileId}
                accumulationBudgetColumn={accumulationBudgetColumn}
                accumulationExpenseOverride={accumulationExpenseOverride}
                decumulationBudgetProfileId={decumulationBudgetProfileId}
                decumulationBudgetColumn={decumulationBudgetColumn}
                decumulationExpenseOverride={decumulationExpenseOverride}
              />

          {/* ================================================================= */}
          {/* DECUMULATION DEFAULTS */}
          {/* ================================================================= */}
          <DecumulationConfig
            isPersonFiltered={isPersonFiltered}
            personFilterName={personFilterName}
            showDecumConfig={showDecumConfig}
            setShowDecumConfig={setShowDecumConfig}
            withdrawalRoutingMode={withdrawalRoutingMode}
            setWithdrawalRoutingMode={setWithdrawalRoutingMode}
            withdrawalOrder={withdrawalOrder}
            setWithdrawalOrder={setWithdrawalOrder}
            withdrawalSplits={withdrawalSplits}
            setWithdrawalSplits={setWithdrawalSplits}
            withdrawalTaxPref={withdrawalTaxPref}
            setWithdrawalTaxPref={setWithdrawalTaxPref}
          />


          {/* ================================================================= */}
          {/* UNIFIED OVERRIDES */}
          {/* ================================================================= */}
          <OverridesPanel state={s} accumulationExpenseOverride={accumulationExpenseOverride} />
        </div>
      </div>
      <SlidePanel
        open={showMethodology}
        onClose={() => setShowMethodology(false)}
        title="Monte Carlo Methodology"
      >
        <MethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showAccumMethodology}
        onClose={() => setShowAccumMethodology(false)}
        title="Accumulation Methodology"
      >
        <AccumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showDecumMethodology}
        onClose={() => setShowDecumMethodology(false)}
        title="Decumulation Methodology"
      >
        <DecumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        open={showValidation}
        onClose={() => setShowValidation(false)}
        title="Why Trust These Numbers?"
      >
        <ValidationContent />
      </SlidePanel>
      <SlidePanel
        open={showAssumptions}
        onClose={() => setShowAssumptions(false)}
        title="Simulation Assumptions"
      >
        {mcQuery.data?.result &&
          "simulationInputs" in mcQuery.data &&
          mcQuery.data.simulationInputs && (
            <SimulationAssumptions
              inputs={mcQuery.data.simulationInputs}
              numTrials={mcQuery.data.result.numTrials}
              onAssetClassOverridesChange={(overrides) => {
                setMcAssetClassOverrides(overrides);
                updateAssetClassOverrides.mutate(overrides);
              }}
              assetClassOverrides={mcAssetClassOverrides}
              fanBandRange={fanBandRange}
              onGlidePathChange={(entries) =>
                updateGlidePath.mutate({ entries })
              }
              onInflationRiskChange={(meanRate, stdDev) => {
                updateInflationRisk.mutate({
                  preset: mcPreset,
                  inflationMean: meanRate,
                  inflationStdDev: stdDev,
                });
                updateInflationOverrides.mutate({ meanRate, stdDev });
              }}
              onClampBoundsChange={(min, max) =>
                updateClampBounds.mutate({
                  preset: "custom",
                  returnClampMin: min,
                  returnClampMax: max,
                })
              }
              outcomeDistribution={{
                successRate: mcQuery.data.result.successRate,
                medianEndBalance: mcQuery.data.result.medianEndBalance,
                p5EndBalance: mcQuery.data.result.worstCase.p5EndBalance,
                terminalBalance:
                  mcQuery.data.result.distributions.terminalBalance,
                sustainableWithdrawalPV:
                  mcQuery.data.result.distributions.sustainableWithdrawalPV,
                depletionAge:
                  mcQuery.data.result.distributions.depletionAge ?? undefined,
                computeTimeMs: mcQuery.data.result.computeTimeMs,
              }}
              deflate={(amount: number) => {
                const termYear =
                  baseYear +
                  (engineSettings!.endAge -
                    (result?.projectionByYear[0]?.age ?? 0));
                return deflate(amount, termYear);
              }}
            />
          )}
      </SlidePanel>
    </>
  );
}
