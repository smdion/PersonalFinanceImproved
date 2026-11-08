"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { HelpTip } from "@/components/ui/help-tip";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  PillBtn,
  LabeledPillGroup,
  ControlZone,
  ZoneSecondaryRow,
} from "./pill-btn";
import { ValidationContent } from "@/components/methodology/validation-content";
import type { DollarBasis } from "@/lib/config/enum-values";
import { formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { SimulationAssumptions } from "@/components/retirement-projection/mc-simulation-assumptions";
import { DecumulationConfig } from "./decumulation-config";
import { OverridesPanel } from "./overrides-panel";
import { ReportRoot } from "./report/report-root";
import {
  EngineNotices,
  SimulationOffNotice,
} from "./projection-card/engine-notices";
import { HeroKpisPanel } from "./projection-card/hero-panel";
import { ScenarioPills } from "./projection-card/compute-zone";
import { PersonViewPills } from "./projection-card/person-view-pills";
import { SimulationSettings } from "./projection-card/simulation-settings";
import { ChartArea } from "./projection-card/chart-area";
import { TableArea } from "./projection-card/table-area";
import { checkReportGate } from "@/lib/pure/advice/report/mc-freshness";
import type { ReportGateFailure } from "@/lib/pure/advice/report/mc-freshness";
import { ReportGateModal } from "./report/report-gate-modal";

// The methodology write-ups (~1,900 lines of prose) load only when one of
// their slide panels is opened (closed panels render nothing).
const MethodologyContent = dynamic(() =>
  import("@/components/methodology/methodology-content").then((m) => ({
    default: m.MethodologyContent,
  })),
);
const AccumulationMethodologyContent = dynamic(() =>
  import("@/components/methodology/accumulation-content").then((m) => ({
    default: m.AccumulationMethodologyContent,
  })),
);
const DecumulationMethodologyContent = dynamic(() =>
  import("@/components/methodology/decumulation-content").then((m) => ({
    default: m.DecumulationMethodologyContent,
  })),
);
import { McResultsSection } from "./projection-mc-results";
import { ProjectionLoader } from "./projection-loader";
import { simulationDollars } from "@/lib/pure/simulation/dollars";
import {
  useProjectionState,
  type EngineContribRate,
} from "./use-projection-state";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

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
  salaryProfileId?: number;
  /** View a non-active Retirement Profile (AssumptionsBand) — threaded to
   *  every engine query so the chart/table this card renders agrees with
   *  whichever profile the band above it is showing. Previously accepted
   *  nowhere in this card's query layer, so the band's "view a non-active
   *  profile" silently never reached the chart — it kept showing the
   *  globally-active profile regardless. */
  retirementProfileId?: number | null;
  snapshotId?: number;
  /** When provided, overrides the internal dollarMode state (for shared page-level toggle). */
  dollarMode?: DollarBasis;
  onDollarModeChange?: (mode: DollarBasis) => void;
}) {
  const state = useProjectionState({
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
    salaryProfileId: props.salaryProfileId,
    retirementProfileId: props.retirementProfileId,
    snapshotId: props.snapshotId,
  });

  // Destructure for the toolbar and stats row (kept inline since they're tightly coupled to layout)
  const {
    withdrawalRoutingMode,
    setWithdrawalRoutingMode,
    withdrawalRoutingModeTouched,
    withdrawalOrder,
    setWithdrawalOrder,
    withdrawalOrderTouched,
    withdrawalSplits,
    setWithdrawalSplits,
    withdrawalSplitsTouched,
    withdrawalTaxPref,
    setWithdrawalTaxPref,
    projectionMode,
    // setProjectionMode removed — MC is always active
    mcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    dollarMode: internalDollarMode,
    setDollarMode: internalSetDollarMode,
    chartView,
    setChartView,
    showBars,
    setShowBars,
    showStabilityBars,
    setShowStabilityBars,
    showIncome,
    setShowIncome,
    fanBandRange,
    setFanBandRange,
    mcBandsByYear,
    scenarioView,
    setScenarioView,
    coastFireCustomAge,
    setCoastFireCustomAge,
    coastFireCustomAgeDraft,
    setCoastFireCustomAgeDraft,
    coastFireProbeResult,
    coastFireProbeLoading,
    coastFireProbeError,
    checkCoastFireCustomAge,
    showMethodology,
    setShowMethodology,
    showAccumMethodology,
    setShowAccumMethodology,
    showDecumMethodology,
    setShowDecumMethodology,
    showValidation,
    setShowValidation,
    showAssumptions,
    setShowAssumptions,
    showDecumConfig,
    setShowDecumConfig,
    setPersonFilter,
    isPersonFiltered,
    updateGlidePath,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    sharedInput,
    debouncedInput,
    personFilterName,
    mcChartPending,
    result,
    hasIndividualAccountData,
    enginePeople,
    engineSettings,
    enginePerPersonSettings,
    deflate,
    autoloadEnabled,
    runSimulation,
    mcAutoloadEnabled,
    runMonteCarlo,
    runCoastFireMc,
    coastFireMcQuery,
    coastFireMcQueryEnabled,
    coastFireAge: deterministicCoastFireAge,
    bracketOptimizerResult,
    mcProgressQuery,
    mcPrefetchProgressQuery,
    coastFireMcProgressQuery,
    rateSeededMcProgressQuery,
    coastFireProbeProgressQuery,
    rateSeededMcQuery,
    isRerunning,
  } = state;

  // If the active scenario's result has no per-person data (Simple-tax-mode
  // MC scenarios like Rate-Seeded) while a specific person is still
  // selected from a previous scenario, snap back to Joint rather than
  // leaving the user stuck on a view that would render $0 everywhere with
  // no indication why — see the matching disabled-pill guard below.
  useEffect(() => {
    if (!result || !isPersonFiltered) return;
    if (!hasIndividualAccountData) setPersonFilter("all");
  }, [result, isPersonFiltered, hasIndividualAccountData, setPersonFilter]);

  // "Recalculating…" indicator. Previously a corner toast (bottom-right,
  // easy to miss and easy to scroll past) that also only covered 4 of the
  // queries that can actually trigger a real recalculation — Rate-Seeded
  // and the Coast FIRE Custom Age probe could run with NO visible
  // indicator at all. Replaced with a fixed banner pinned to the top of
  // the viewport (impossible to miss regardless of scroll position, same
  // z-index precedent as ToastContainer) that now covers every query that
  // can trigger a real wait, consistently.
  //
  // Shows real "N / total trials" progress once available — see
  // mcProgressQuery in use-projection-queries.ts, backed by the Monte
  // Carlo worker's own progress messages (monte-carlo-worker-client.ts).
  // Only the main mcQuery carries a trackable runId today; every other
  // query here still shows the plain indeterminate state, which is
  // honest — they're either fast (engine-only) or don't yet report
  // sub-progress (Coast FIRE's multi-probe binary search).
  const isRecalculating =
    engineQuery.isFetching ||
    mcPrefetchQuery.isFetching ||
    mcQuery.isFetching ||
    coastFireMcQuery.isFetching ||
    rateSeededMcQuery.isFetching ||
    coastFireProbeLoading ||
    isRerunning;
  // Whichever MC-ish job is actually running right now, in priority order
  // — the ones tied to what the user is actively viewing/doing outrank
  // the passive background prefetch, so switching to (say) Coast FIRE
  // while the baseline prefetch happens to also be mid-run shows YOUR
  // progress, not a random one. Each *ProgressQuery only polls (and thus
  // only has data) while its OWN query/action is in flight — see each
  // one's `enabled` clause in use-projection-queries.ts — so at most one
  // of these should ever be non-null in practice; the fallback chain
  // exists for the rare moment two overlap (e.g. "Re-run" fires both
  // baseline and Coast FIRE MC together via Promise.all).
  const mcProgress = mcQuery.isFetching
    ? (mcProgressQuery.data ?? null)
    : coastFireMcQuery.isFetching
      ? (coastFireMcProgressQuery.data ?? null)
      : rateSeededMcQuery.isFetching
        ? (rateSeededMcProgressQuery.data ?? null)
        : coastFireProbeLoading
          ? (coastFireProbeProgressQuery.data ?? null)
          : mcPrefetchQuery.isFetching
            ? (mcPrefetchProgressQuery.data ?? null)
            : isRerunning
              ? (mcProgressQuery.data ?? coastFireMcProgressQuery.data ?? null)
              : null;

  // Allow page-level dollarMode override (for shared toggle across tabs).
  // Sync the prop into internal state so derived data (deflate) reads the correct value.
  const dollarMode = props.dollarMode ?? internalDollarMode;
  const setDollarMode = props.onDollarModeChange ?? internalSetDollarMode;
  useEffect(() => {
    if (
      props.dollarMode !== undefined &&
      props.dollarMode !== internalDollarMode
    ) {
      internalSetDollarMode(props.dollarMode);
    }
  }, [props.dollarMode, internalDollarMode, internalSetDollarMode]);

  const {
    parentCategoryFilter,
    people,
    accumulationBudgetProfileId,
    accumulationBudgetColumn,
    accumulationExpenseOverride,
    decumulationBudgetProfileId,
    decumulationBudgetColumn,
    decumulationExpenseOverride,
  } = props;

  // Print/export report. "none" = normal screen view (default print
  // behavior, unchanged). "basic" prints just the chart+table with page
  // chrome hidden. "advisor" (was "fancy") mounts the purpose-built
  // advisor-report document instead — ReportRoot, not the interactive
  // chart/table — hidden on screen via `hidden print:block`, so this is a
  // no-op on layout until printed. Only reachable after checkReportGate
  // passes (see handlePrintAdvisor below) — never printed with stale/
  // missing Monte Carlo data.
  const [reportMode, setReportMode] = useState<"none" | "basic" | "advisor">(
    "none",
  );
  const [gateFailure, setGateFailure] = useState<ReportGateFailure | null>(
    null,
  );
  const originalTitleRef = useRef<string>("");
  // "Print Chart & Table" is a deliberate export action, not a screenshot
  // of whatever's on screen — it should always include every year
  // regardless of the interactive table's own milestone-only toggle
  // state, restored after printing so it doesn't silently change what the
  // user was looking at on screen.
  const priorShowAllYearsRef = useRef<boolean | null>(null);
  const handlePrint = (mode: "basic" | "advisor") => {
    originalTitleRef.current = document.title;
    setReportMode(mode);
    document.title = `Retirement Projection - ${new Date().toLocaleDateString()}`;
    if (mode === "basic" && !state.showAllYears) {
      priorShowAllYearsRef.current = state.showAllYears;
      state.setShowAllYears(true);
    }
    // Two rAFs: one for React to commit the report-only DOM, one for the
    // browser to paint it, before the print dialog captures the page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  };
  const handlePrintAdvisor = () => {
    const gate = checkReportGate({
      scenarioView,
      mcTaxMode,
      sharedInput,
      debouncedInput,
      engineQuery: {
        isFetching: engineQuery.isFetching,
        isPlaceholderData: engineQuery.isPlaceholderData,
        data: engineQuery.data,
      },
      mcQuery: {
        isFetching: mcQuery.isFetching,
        data: mcQuery.data?.result ?? null,
      },
    });
    if (!gate.ok) {
      setGateFailure(gate.failure ?? null);
      return;
    }
    handlePrint("advisor");
  };
  useEffect(() => {
    const reset = () => {
      setReportMode("none");
      if (originalTitleRef.current) document.title = originalTitleRef.current;
      if (priorShowAllYearsRef.current != null) {
        state.setShowAllYears(priorShowAllYearsRef.current);
        priorShowAllYearsRef.current = null;
      }
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.setShowAllYears is a stable useState setter, safe to close over once
  }, []);

  return (
    <>
      {isRecalculating && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md print:hidden"
        >
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          {mcProgress && mcProgress.total > 0 ? (
            <>
              <span>
                Running simulation… {mcProgress.done.toLocaleString()}
                {" / "}
                {mcProgress.total.toLocaleString()} trials (
                {formatPercent(
                  safeDivide(mcProgress.done, mcProgress.total, 0),
                  0,
                )}
                )
              </span>
              <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-white/25">
                <span
                  className="block h-full rounded-full bg-white transition-[width]"
                  style={{
                    width: `${Math.min(100, safeDivide(mcProgress.done, mcProgress.total, 0) * 100)}%`,
                  }}
                />
              </span>
            </>
          ) : (
            <span>Recalculating…</span>
          )}
        </div>
      )}
      <div className="mb-6 space-y-6">
        <div className="space-y-6">
          {/* ================================================================= */}
          {/* RESULTS */}
          {/* ================================================================= */}

          <EngineNotices engineQuery={engineQuery} />

          {/* Print/export report controls. print:hidden so the
              buttons themselves never appear in the printed output. */}
          {result && (
            <div className="text-caption flex items-center gap-3 print:hidden">
              <button
                type="button"
                onClick={() => handlePrint("basic")}
                className="text-muted hover:text-secondary underline"
              >
                Print Chart &amp; Table
              </button>
              <button
                type="button"
                onClick={handlePrintAdvisor}
                className="text-muted hover:text-secondary underline"
              >
                Print Full Report
              </button>
            </div>
          )}

          {gateFailure && (
            <ReportGateModal
              failure={gateFailure}
              isRunning={isRerunning}
              onRunSimulation={() => {
                runMonteCarlo();
                setGateFailure(null);
              }}
              onCancel={() => setGateFailure(null)}
            />
          )}

          {/* Advisor-report-only root — mounted only in "advisor" mode,
              hidden on screen, print-visible. Only reached when the gate
              already passed, so `result`/`mcQuery.data`/`engineSettings`
              are all guaranteed present here. */}
          {reportMode === "advisor" && result && mcQuery.data?.result && (
            <div className="hidden print:block">
              <ReportRoot
                projectionResult={result}
                mcResult={mcQuery.data.result}
                deflate={deflate}
                coastFireAge={deterministicCoastFireAge}
                peopleNames={(people ?? enginePeople ?? []).map((p) => p.name)}
                generatedAt={new Date()}
                engineSettings={engineSettings}
                perPersonSettings={enginePerPersonSettings}
                rmdExcessYears={
                  result.projectionByYear.filter(
                    (y) =>
                      y.phase === "decumulation" && y.rmdExcessAmount > 0.01,
                  ).length
                }
                qcdYears={
                  result.projectionByYear.filter(
                    (y) => y.phase === "decumulation" && y.qcdAmount > 0.01,
                  ).length
                }
                irmaaCappedRothYears={
                  result.projectionByYear.filter(
                    (y) =>
                      y.phase === "decumulation" &&
                      y.rothConversionIrmaaCapped === true,
                  ).length
                }
                bracketOptimizerResult={bracketOptimizerResult}
              />
            </div>
          )}

          {/* ── CONTENT BLOCK ────────────────────────────────────────────────
               Every section renders a skeleton or real content at the SAME
               DOM position so the layout never shifts during loading. */}
          {(engineQuery.isLoading || !!result) && (
            <div className="space-y-4">
              {/* Hero KPIs (headline numbers) — always shown on screen;
                  print-visible only in the "advisor" report tier (basic
                  tier prints just the chart+table). */}
              <HeroKpisPanel
                reportMode={reportMode}
                engineQuery={engineQuery}
                state={state}
              />

              {/* MC auto-load disabled notice — only when real data */}
              <SimulationOffNotice
                result={result}
                mcAutoloadEnabled={mcAutoloadEnabled}
                mcPrefetchQuery={mcPrefetchQuery}
                runMonteCarlo={runMonteCarlo}
              />

              {/* MC assumptions summary — only when real data */}
              {result && (
                <div className="print:hidden">
                  <McResultsSection state={state} />
                </div>
              )}

              {/* Toolbar — skeleton during engine load, real controls once data arrives */}
              {engineQuery.isLoading ? (
                <div
                  className="bg-surface-sunken h-[70px] animate-pulse rounded-lg"
                  style={{ animationDuration: "1.8s" }}
                />
              ) : null}

              {/* Unified toolbar — two rows (only when real data). Row 1
                  = compute-time inputs (what to run), Row 2 = display-time
                  lenses (how to show what's already computed). Both render
                  here (not inside the chart) so they stay visible/
                  interactive during engineQuery.isLoading and use one
                  consistent PillBtn/LabeledPillGroup/LabeledSelect
                  convention instead of four separate hand-rolled ones. */}
              {result &&
                (() => {
                  const isMc = projectionMode === "monteCarlo";
                  // AVAILABILITY (can the pill be clicked at all) is sourced
                  // from the cheap deterministic `coastFireQuery`, which
                  // always runs — the MC probe is now on-demand (fires once
                  // this scenario is actually selected, see
                  // use-projection-queries.ts's coastFireMcQuery docblock),
                  // so gating availability on MC data would make the pill
                  // permanently unclickable (it needs a click to start
                  // loading, but couldn't be clicked until it had loaded).
                  //
                  // The LABEL/NUMBER still prefers the MC-verified result
                  // once it's loaded — deterministic ignores sequence-of-
                  // returns risk, so the two can legitimately disagree, and
                  // this pill's own scenario runs off coastFireMcResult (see
                  // use-projection-queries.ts's activeCoastFireMcResult).
                  // Before MC data exists, showing the deterministic guess
                  // is the "basic KPI info" — it self-corrects to the
                  // verified number the moment MC loads. status ===
                  // "already_coast" is the one case where MC HAS resolved
                  // and definitively says there's no distinct future age to
                  // show (that's the separate "Coast FIRE (Today)" pill) —
                  // showing a fallback age there would reproduce a real bug
                  // (pill said "Age 37", hero card said "Age 47" for the
                  // same household), so that case still nulls out rather
                  // than falling back.
                  const coastFireMcData = coastFireMcQuery.data?.result;
                  const coastFireAge =
                    coastFireMcData?.status === "found"
                      ? coastFireMcData.coastFireAge
                      : coastFireMcData?.status === "already_coast"
                        ? null
                        : deterministicCoastFireAge;
                  const coastFireAvailable = deterministicCoastFireAge != null;
                  const hasMc = mcBandsByYear != null;
                  // The Balance chart's stacked bars are built from real
                  // per-account tax-type/account data — a Simple-tax-mode
                  // scenario has none, so there's nothing for this toggle
                  // to show or hide.
                  const baselineUnavailable =
                    chartView === "balance" && !hasIndividualAccountData;
                  const baselineDisabledTitle = baselineUnavailable
                    ? "Not available for this scenario — Simple tax mode doesn't track individual accounts, so there's no per-account breakdown to show as bars. Switch to Advanced tax mode to use this."
                    : undefined;
                  return (
                    <div className="space-y-2 print:hidden">
                      {/* COMPUTE zone — decisions that change what gets
                          calculated. Scenario is the primary control
                          (bigger, colored active state); everything else
                          is secondary, below the dashed rule. */}
                      <ControlZone
                        tone="compute"
                        title="Compute"
                        why="what gets run"
                      >
                        <ScenarioPills
                          coastFireAvailable={coastFireAvailable}
                          state={state}
                          coastFireAge={coastFireAge}
                          scenarioView={scenarioView}
                          setScenarioView={setScenarioView}
                        />
                        {scenarioView === "coastFireCustom" &&
                          (() => {
                            const currentAge =
                              result.projectionByYear[0]?.age ?? 0;
                            const maxAge = engineSettings.retirementAge - 1;
                            const committedAge =
                              coastFireCustomAge ?? currentAge;
                            // What the box actually shows while typing —
                            // the raw, unclamped draft if the user has one,
                            // else the last committed age. Clamping used to
                            // happen on every keystroke (via
                            // setCoastFireCustomAge directly in onChange),
                            // which corrupted multi-digit entry: typing "4"
                            // of "42" got clamped up to the min bound
                            // immediately, forcing the DOM value to change
                            // mid-keystroke so the "2" landed in the wrong
                            // position — e.g. produced "54" instead of "42".
                            // Clamping now happens only in commitDraft, on
                            // blur or "Check this age".
                            const draftText =
                              coastFireCustomAgeDraft ?? String(committedAge);
                            const commitDraft = (): number => {
                              const v = parseInt(draftText, 10);
                              const clamped = isNaN(v)
                                ? committedAge
                                : Math.min(maxAge, Math.max(currentAge, v));
                              setCoastFireCustomAge(clamped);
                              setCoastFireCustomAgeDraft(null);
                              return clamped;
                            };
                            return (
                              <div className="bg-surface-sunken -mt-1 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm">
                                <label
                                  htmlFor="coast-fire-custom-age"
                                  className="text-caption text-muted"
                                >
                                  {state.primaryName
                                    ? `Check ${state.primaryName}'s age`
                                    : "Check age"}
                                </label>
                                <input
                                  id="coast-fire-custom-age"
                                  type="number"
                                  min={currentAge}
                                  max={maxAge}
                                  step={1}
                                  value={draftText}
                                  onChange={(e) =>
                                    setCoastFireCustomAgeDraft(e.target.value)
                                  }
                                  onBlur={commitDraft}
                                  className="w-16 rounded border px-1.5 py-0.5 text-sm tabular-nums"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    checkCoastFireCustomAge(commitDraft())
                                  }
                                  disabled={coastFireProbeLoading}
                                  className="text-label border-subtle text-muted hover:bg-surface-primary/80 rounded-md border px-2.5 py-1 font-semibold shadow-sm transition-colors disabled:opacity-50"
                                >
                                  {coastFireProbeLoading
                                    ? "Checking…"
                                    : "Check this age"}
                                </button>
                                {coastFireProbeError && (
                                  <span className="text-caption text-red-600">
                                    {coastFireProbeError}
                                  </span>
                                )}
                                {!coastFireProbeError &&
                                  coastFireProbeResult &&
                                  coastFireProbeResult.probeAge ===
                                    committedAge && (
                                    <span
                                      className={`text-caption font-medium ${
                                        coastFireProbeResult.passes
                                          ? "text-green-600"
                                          : "text-red-600"
                                      }`}
                                    >
                                      {coastFireProbeResult.passes
                                        ? "✓ Passes"
                                        : "✗ Doesn't pass"}{" "}
                                      (
                                      {formatPercent(
                                        coastFireProbeResult.successRate,
                                        0,
                                      )}
                                      )
                                    </span>
                                  )}
                              </div>
                            );
                          })()}
                        <ZoneSecondaryRow>
                          <PersonViewPills state={state} people={people} />
                          {isMc && <SimulationSettings state={state} />}
                        </ZoneSecondaryRow>
                      </ControlZone>

                      {/* DISPLAY zone — lenses on results already computed.
                          Chart type is the primary control; Dollars rides
                          alongside it since it's the other frequently-
                          touched one. Everything else is secondary. */}
                      <ControlZone
                        tone="display"
                        title="Display"
                        why="how it's shown"
                      >
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <LabeledPillGroup
                            label="Chart"
                            size="lg"
                            helpTip={
                              <HelpTip
                                maxWidth={380}
                                lines={[
                                  "Balance ($): your projected account balances over time, the main chart.",
                                  'Yearly Income Stability (%): a completely different chart, showing each year\'s spending as a % of a baseline instead of a dollar balance. Pick which baseline with "Compare vs" once selected.',
                                ]}
                              />
                            }
                          >
                            <PillBtn
                              size="lg"
                              tone="display"
                              active={chartView === "balance"}
                              onClick={() => setChartView("balance")}
                              label="Balance"
                            />
                            <PillBtn
                              size="lg"
                              tone="display"
                              active={chartView !== "balance"}
                              onClick={() => {
                                if (chartView === "balance")
                                  setChartView("strategy");
                              }}
                              label="Yearly Income Stability"
                            />
                          </LabeledPillGroup>
                          <LabeledPillGroup
                            label="Dollars"
                            helpTip={
                              <HelpTip
                                maxWidth={400}
                                lines={[
                                  <div key="today" className="space-y-1">
                                    <div>
                                      <strong className="text-blue-300">
                                        Today&apos;s $
                                      </strong>{" "}
                                      <span className="text-faint">
                                        (default)
                                      </span>
                                    </div>
                                    <div className="text-faint text-xs">
                                      Removes inflation — every dollar means the
                                      same as it does right now. A $100k balance
                                      in 2050 shows what that money actually
                                      buys today.
                                    </div>
                                    <div className="text-faint mt-0.5 text-xs">
                                      Use when:
                                    </div>
                                    <ul
                                      className="text-faint ml-3 space-y-0.5 text-xs"
                                      style={{ listStyleType: "'▸ '" }}
                                    >
                                      <li>
                                        <span className="text-blue-300/80">
                                          Will I have enough to retire?
                                        </span>
                                      </li>
                                      <li>
                                        Comparing your nest egg to your{" "}
                                        <em>current</em> salary
                                      </li>
                                      <li>
                                        Checking if withdrawals cover
                                        today&apos;s expenses
                                      </li>
                                      <li>
                                        Evaluating whether savings rate keeps up
                                      </li>
                                      <li>
                                        Comparing scenarios across decades
                                      </li>
                                    </ul>
                                    <div className="text-caption text-muted mt-0.5 italic">
                                      Salary and withdrawals may appear flat or
                                      declining — that&apos;s not a bug, it
                                      means purchasing power isn&apos;t
                                      outpacing inflation.
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
                                      The actual amounts as they&apos;ll appear
                                      on statements, tax forms, and paychecks.
                                      They grow because your raise and return
                                      rates already include inflation —
                                      it&apos;s counted once, not stacked on
                                      top.
                                    </div>
                                    <div className="text-faint mt-0.5 text-xs">
                                      Use when:
                                    </div>
                                    <ul
                                      className="text-faint ml-3 space-y-0.5 text-xs"
                                      style={{ listStyleType: "'▸ '" }}
                                    >
                                      <li>
                                        Checking if you&apos;ll hit{" "}
                                        <span className="text-green-300/80">
                                          401k/IRA contribution limits
                                        </span>
                                      </li>
                                      <li>
                                        Planning{" "}
                                        <span className="text-green-300/80">
                                          Roth conversions
                                        </span>{" "}
                                        against tax brackets
                                      </li>
                                      <li>
                                        Estimating{" "}
                                        <span className="text-green-300/80">
                                          RMD amounts
                                        </span>
                                      </li>
                                      <li>
                                        Seeing what your account balance will
                                        actually read
                                      </li>
                                      <li>
                                        Modeling{" "}
                                        <span className="text-green-300/80">
                                          IRMAA thresholds
                                        </span>
                                      </li>
                                      <li>Filing-year tax projections</li>
                                    </ul>
                                  </div>,
                                  <div
                                    key="tip"
                                    className="text-faint border-t pt-1.5 text-xs italic"
                                  >
                                    Same projection, different lens.{" "}
                                    <span className="text-blue-300">
                                      Today&apos;s $
                                    </span>{" "}
                                    answers{" "}
                                    <strong className="text-faint">
                                      &quot;is this enough?&quot;
                                    </strong>{" "}
                                    —{" "}
                                    <span className="text-green-300">
                                      Future $
                                    </span>{" "}
                                    answers{" "}
                                    <strong className="text-faint">
                                      &quot;what will the statement say?&quot;
                                    </strong>
                                    <div className="mt-1">
                                      The gap between the two is your{" "}
                                      <strong className="text-faint">
                                        real raise
                                      </strong>
                                      : the part of your growth that actually
                                      outpaces inflation. If they line up, your
                                      raises are only keeping you even with
                                      prices.
                                    </div>
                                  </div>,
                                ]}
                              />
                            }
                          >
                            <PillBtn
                              active={dollarMode === "real"}
                              onClick={() => setDollarMode("real")}
                              label="Today's $"
                            />
                            <PillBtn
                              active={dollarMode === "nominal"}
                              onClick={() => setDollarMode("nominal")}
                              label="Future $"
                            />
                          </LabeledPillGroup>
                        </div>
                        <ZoneSecondaryRow>
                          {chartView !== "balance" && (
                            <LabeledPillGroup
                              label="Compare vs"
                              helpTip={
                                <HelpTip
                                  maxWidth={380}
                                  lines={[
                                    "Strategy: each year's spending as a % of what your withdrawal strategy actually targets that year (its real, guardrail/raise-adjusted number — not just year 1 grown by inflation). Measures self-consistency: is the strategy delivering what it promised itself?",
                                    "Budget: the same spending, but as a % of your stated retirement budget instead. Measures whether your real-world needs are met.",
                                    "For budget-based strategies (Fixed, Forgo, Guyton-Klinger) these two often look similar, since year-1 spending IS the budget for those — the gap opens up for portfolio-linked strategies (Constant %, Vanguard Dynamic) or once guardrails start adjusting spending away from the original budget.",
                                  ]}
                                />
                              }
                            >
                              <PillBtn
                                active={chartView === "strategy"}
                                onClick={() => setChartView("strategy")}
                                label="Strategy"
                              />
                              <PillBtn
                                active={chartView === "budget"}
                                onClick={() => setChartView("budget")}
                                label="Budget"
                              />
                            </LabeledPillGroup>
                          )}
                          <LabeledPillGroup label="Baseline">
                            <PillBtn
                              active={
                                chartView === "balance"
                                  ? showBars
                                  : showStabilityBars
                              }
                              onClick={() =>
                                chartView === "balance"
                                  ? setShowBars(true)
                                  : setShowStabilityBars(true)
                              }
                              label="On"
                              disabled={baselineUnavailable}
                              title={baselineDisabledTitle}
                            />
                            <PillBtn
                              active={
                                chartView === "balance"
                                  ? !showBars
                                  : !showStabilityBars
                              }
                              onClick={() =>
                                chartView === "balance"
                                  ? setShowBars(false)
                                  : setShowStabilityBars(false)
                              }
                              label="Off"
                              disabled={baselineUnavailable}
                              title={baselineDisabledTitle}
                            />
                          </LabeledPillGroup>
                          {chartView === "balance" && (
                            <LabeledPillGroup
                              label="Income"
                              helpTip={
                                <HelpTip
                                  maxWidth={320}
                                  text="Shows total portfolio withdrawal and Social Security income for each retirement year, on their own axis to the right — separate from the account balances the bars show. Both are your strategy's real computed numbers, not estimates."
                                />
                              }
                            >
                              <PillBtn
                                active={showIncome}
                                onClick={() => setShowIncome(true)}
                                label="On"
                              />
                              <PillBtn
                                active={!showIncome}
                                onClick={() => setShowIncome(false)}
                                label="Off"
                              />
                            </LabeledPillGroup>
                          )}
                          {hasMc && (
                            <LabeledPillGroup
                              label="Confidence Band"
                              helpTip={
                                <HelpTip
                                  maxWidth={360}
                                  lines={[
                                    "Confidence bands show the range of simulation outcomes.",
                                    <span key="p25">
                                      <strong className="text-purple-300">
                                        50%
                                      </strong>{" "}
                                      — Middle 50% of outcomes. Tightest view,
                                      shows the most likely range.
                                    </span>,
                                    <span key="p10">
                                      <strong className="text-purple-300">
                                        80%
                                      </strong>{" "}
                                      — Middle 80% of outcomes. Includes
                                      moderately good and bad scenarios.
                                    </span>,
                                    <span key="p5">
                                      <strong className="text-purple-300">
                                        90%
                                      </strong>{" "}
                                      — Middle 90% of outcomes. Widest view.
                                    </span>,
                                  ]}
                                />
                              }
                            >
                              <PillBtn
                                active={fanBandRange === "off"}
                                onClick={() => setFanBandRange("off")}
                                label="Off"
                              />
                              <PillBtn
                                active={fanBandRange === "p25-p75"}
                                onClick={() => setFanBandRange("p25-p75")}
                                label="50%"
                              />
                              <PillBtn
                                active={fanBandRange === "p10-p90"}
                                onClick={() => setFanBandRange("p10-p90")}
                                label="80%"
                              />
                              <PillBtn
                                active={fanBandRange === "p5-p95"}
                                onClick={() => setFanBandRange("p5-p95")}
                                label="90%"
                              />
                            </LabeledPillGroup>
                          )}
                        </ZoneSecondaryRow>
                      </ControlZone>
                    </div>
                  );
                })()}

              {/* Chart area — engine skeleton, then real chart (with MC skeleton
                  if MC is still pending after engine completes). The advisor
                  report is a purpose-built document, not a printout of the
                  interactive chart — print:hidden whenever "advisor" mode
                  is active. */}
              <ChartArea
                reportMode={reportMode}
                engineQuery={engineQuery}
                chartView={chartView}
                state={state}
                mcChartPending={mcChartPending}
              />
            </div>
          )}

          {/* LOADER — full skeleton card during engine loading / action state;
              slim progress strip during MC-only loading (real content visible above) */}
          {(() => {
            const enginePhase = engineQuery.isLoading
              ? ("active" as const)
              : engineQuery.isSuccess
                ? ("done" as const)
                : ("pending" as const);

            const mcInitialLoading =
              !mcPrefetchQuery.data && mcPrefetchQuery.isFetching;
            const mcPhase = !mcAutoloadEnabled
              ? ("disabled" as const)
              : mcInitialLoading
                ? ("active" as const)
                : mcPrefetchQuery.data
                  ? ("done" as const)
                  : ("pending" as const);

            // "disabled" here means the strip hides entirely (see the
            // !== "disabled" guards below). coastFireMcQueryEnabled comes
            // from use-projection-queries.ts — the same value that gates
            // coastFireMcQuery's own `enabled` there, so this can't drift
            // out of sync with it the way a locally re-derived copy could.
            const coastFireMcPhase = !coastFireMcQueryEnabled
              ? ("disabled" as const)
              : coastFireMcQuery.isLoading || coastFireMcQuery.isFetching
                ? ("active" as const)
                : coastFireMcQuery.data
                  ? ("done" as const)
                  : ("pending" as const);

            const showActionState =
              !autoloadEnabled && !engineQuery.data && !engineQuery.isLoading;

            return (
              <div className="print:hidden">
                <ProjectionLoader
                  enginePhase={enginePhase}
                  mcPhase={mcPhase}
                  coastFireMcPhase={coastFireMcPhase}
                  showActionState={showActionState}
                  onRunSimulation={runSimulation}
                  onRunMonteCarlo={runMonteCarlo}
                  onRunCoastFireMc={runCoastFireMc}
                />
              </div>
            );
          })()}

          {/* TABLE — skeleton while engine is loading or in action state,
              real table otherwise. Same DOM position always. The advisor
              report is a purpose-built document, not a printout of the
              interactive table — print:hidden whenever "advisor" mode is
              active (it renders its own simplified table instead). */}
          <TableArea
            reportMode={reportMode}
            engineQuery={engineQuery}
            autoloadEnabled={autoloadEnabled}
            state={state}
            people={people}
            parentCategoryFilter={parentCategoryFilter}
            accumulationBudgetProfileId={accumulationBudgetProfileId}
            accumulationBudgetColumn={accumulationBudgetColumn}
            accumulationExpenseOverride={accumulationExpenseOverride}
            decumulationBudgetProfileId={decumulationBudgetProfileId}
            decumulationBudgetColumn={decumulationBudgetColumn}
            decumulationExpenseOverride={decumulationExpenseOverride}
          />

          {/* DECUMULATION DEFAULTS */}
          <div className="print:hidden">
            <DecumulationConfig
              isPersonFiltered={isPersonFiltered}
              personFilterName={personFilterName}
              showDecumConfig={showDecumConfig}
              setShowDecumConfig={setShowDecumConfig}
              withdrawalRoutingMode={withdrawalRoutingMode}
              setWithdrawalRoutingMode={setWithdrawalRoutingMode}
              withdrawalRoutingModeTouched={withdrawalRoutingModeTouched}
              withdrawalOrder={withdrawalOrder}
              setWithdrawalOrder={setWithdrawalOrder}
              withdrawalOrderTouched={withdrawalOrderTouched}
              persistedWithdrawalOrder={engineSettings?.withdrawalOrder}
              withdrawalSplits={withdrawalSplits}
              setWithdrawalSplits={setWithdrawalSplits}
              withdrawalSplitsTouched={withdrawalSplitsTouched}
              persistedWithdrawalSplits={engineSettings?.withdrawalSplits}
              withdrawalTaxPref={withdrawalTaxPref}
              setWithdrawalTaxPref={setWithdrawalTaxPref}
              activeSpendingStrategy={engineSettings?.withdrawalStrategy}
              discretionaryWithdrawalOrder={
                engineSettings?.discretionaryWithdrawalOrder
              }
              persistedWithdrawalRoutingMode={
                engineSettings?.withdrawalRoutingMode
              }
              enableAcaAwareness={engineSettings?.enableAcaAwareness}
              enableIrmaaAwareness={engineSettings?.enableIrmaaAwareness}
            />
          </div>

          {/* UNIFIED OVERRIDES */}
          <div className="print:hidden">
            <OverridesPanel
              state={state}
              accumulationExpenseOverride={accumulationExpenseOverride}
            />
          </div>
        </div>
      </div>
      <SlidePanel
        isOpen={showMethodology}
        onClose={() => setShowMethodology(false)}
        title="Simulation Methodology"
      >
        <MethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showAccumMethodology}
        onClose={() => setShowAccumMethodology(false)}
        title="Accumulation Methodology"
      >
        <AccumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showDecumMethodology}
        onClose={() => setShowDecumMethodology(false)}
        title="Decumulation Methodology"
      >
        <DecumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showValidation}
        onClose={() => setShowValidation(false)}
        title="Why Trust These Numbers?"
      >
        <ValidationContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showAssumptions}
        onClose={() => setShowAssumptions(false)}
        title="Simulation Assumptions"
      >
        {mcQuery.data?.result && "simulationInputs" in mcQuery.data && (
          <SimulationAssumptions
            inputs={mcQuery.data.simulationInputs}
            numTrials={mcQuery.data.result.numTrials}
            onAssetClassOverridesChange={(overrides) => {
              setMcAssetClassOverrides(overrides);
              updateAssetClassOverrides.mutate(overrides);
            }}
            assetClassOverrides={mcAssetClassOverrides}
            fanBandRange={fanBandRange}
            onGlidePathChange={(entries) => updateGlidePath.mutate({ entries })}
            onInflationRiskChange={(stdDev) =>
              updateInflationOverrides.mutate({ stdDev })
            }
            onClampBoundsChange={(min, max) =>
              updateClampBounds.mutate({
                preset: "custom",
                returnClampMin: min,
                returnClampMax: max,
              })
            }
            outcomeDistribution={{
              successRate: mcQuery.data.result.successRate,
              ...simulationDollars(mcQuery.data.result, dollarMode),
              sustainableWithdrawalPV:
                mcQuery.data.result.distributions.sustainableWithdrawalPV,
              failureAge:
                mcQuery.data.result.distributions.failureAge ?? undefined,
              computeTimeMs: mcQuery.data.result.computeTimeMs,
            }}
          />
        )}
      </SlidePanel>
    </>
  );
}
