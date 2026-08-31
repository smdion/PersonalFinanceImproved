"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { HelpTip } from "@/components/ui/help-tip";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  PillBtn,
  LabeledPillGroup,
  LabeledSelect,
  ControlZone,
  ZoneSecondaryRow,
} from "./pill-btn";
import { MethodologyContent } from "@/components/methodology-content";
import { AccumulationMethodologyContent } from "@/components/accumulation-methodology-content";
import { DecumulationMethodologyContent } from "@/components/decumulation-methodology-content";
import { ValidationContent } from "@/components/validation-content";
// formatCurrency import removed — no longer used inline
import { formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { SimulationAssumptions } from "@/components/cards/mc-simulation-assumptions";
import { DecumulationConfig } from "./decumulation-config";
import { OverridesPanelV2 as OverridesPanel } from "./overrides-panel-v2";
import { ProjectionTable } from "./projection-table";
import { ProjectionHeroKpis } from "./projection-hero-kpis";
import { ProjectionChartSkeleton } from "./projection-chart-skeleton";
import { ProjectionTableSkeleton } from "./projection-table-skeleton";
import { ReportHeader, ReportFooter } from "./report-header";
import { ReportAssumptionsSummary } from "./report-assumptions-summary";

// Code-split Recharts-heavy children (v0.5 expert-review M8). Each chart is
// ~250KB of recharts payload that loads only when the projection card mounts.
// ssr:false because Recharts isn't SSR-friendly.
const ProjectionChart = dynamic(
  () =>
    import("./projection-chart").then((m) => ({ default: m.ProjectionChart })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);
const SpendingStabilityChart = dynamic(
  () =>
    import("./spending-stability-chart").then((m) => ({
      default: m.SpendingStabilityChart,
    })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);
import { McResultsSection } from "./projection-mc-results";
import { ProjectionLoader } from "./projection-loader";
import {
  useProjectionState,
  type EngineContribRate,
} from "./use-projection-state";

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
  salaryProfileId?: number;
  snapshotId?: number;
  /** When provided, overrides the internal dollarMode state (for shared page-level toggle). */
  dollarMode?: "nominal" | "real";
  onDollarModeChange?: (mode: "nominal" | "real") => void;
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
    snapshotId: props.snapshotId,
  });

  // Destructure for the toolbar and stats row (kept inline since they're tightly coupled to layout)
  const {
    withdrawalRoutingMode,
    setWithdrawalRoutingMode,
    withdrawalOrder,
    setWithdrawalOrder,
    withdrawalSplits,
    setWithdrawalSplits,
    withdrawalTaxPref,
    setWithdrawalTaxPref,
    projectionMode,
    // setProjectionMode removed — MC is always active
    mcTrials,
    setMcTrials,
    mcPreset,
    setMcPreset,
    mcTaxMode,
    setMcTaxMode,
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
    personFilter,
    setPersonFilter,
    isPersonFiltered,
    updateGlidePath,
    updateInflationRisk,
    updateClampBounds,
    updateAssetClassOverrides,
    updateInflationOverrides,
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    personFilterName,
    mcChartPending,
    result,
    hasIndividualAccountData,
    enginePeople,
    engineSettings,
    baseYear,
    deflate,
    autoloadEnabled,
    runSimulation,
    mcAutoloadEnabled,
    runMonteCarlo,
    coastFireMcAutoloadEnabled,
    runCoastFireMc,
    coastFireMcQuery,
    coastFireAge: deterministicCoastFireAge,
    mcProgressQuery,
    rateSeededMcQuery,
    isRerunning,
  } = state;

  // If the active scenario's result has no per-person data (Simple-tax-mode
  // MC scenarios like Rate-Seeded) while a specific person is still
  // selected from a previous scenario, snap back to Joint rather than
  // leaving the user stuck on a view that would render $0 everywhere with
  // no indication why (live-user finding, 2026-08-28 — see the matching
  // disabled-pill guard below).
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
  // can trigger a real wait, consistently (live-user finding, 2026-08-30).
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
  const mcProgress = mcQuery.isFetching ? (mcProgressQuery.data ?? null) : null;

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

  // R42 — print/export report. "none" = normal screen view (default print
  // behavior, unchanged). "basic" prints just the chart+table with page
  // chrome hidden. "fancy" additionally mounts the report header, hero KPI
  // summary, and assumptions section (all print-only — hidden on screen via
  // `hidden print:block`, so this is a no-op on layout until printed).
  const [reportMode, setReportMode] = useState<"none" | "basic" | "fancy">(
    "none",
  );
  const originalTitleRef = useRef<string>("");
  const handlePrint = (mode: "basic" | "fancy") => {
    originalTitleRef.current = document.title;
    setReportMode(mode);
    document.title = `Retirement Projection - ${new Date().toLocaleDateString()}`;
    // Two rAFs: one for React to commit the report-only DOM, one for the
    // browser to paint it, before the print dialog captures the page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  };
  useEffect(() => {
    const reset = () => {
      setReportMode("none");
      if (originalTitleRef.current) document.title = originalTitleRef.current;
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  return (
    <>
      {isRecalculating && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-[100] print:hidden flex items-center justify-center gap-3 bg-blue-600 text-white text-sm font-medium px-4 py-2 shadow-md"
        >
          <span
            className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0"
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
              <span className="w-32 h-1.5 rounded-full bg-white/25 overflow-hidden shrink-0">
                <span
                  className="block h-full bg-white rounded-full transition-[width]"
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
      <div className="space-y-6 mb-6">
        <div className="space-y-6">
          {/* ================================================================= */}
          {/* RESULTS */}
          {/* ================================================================= */}

          {engineQuery.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Failed to run engine: {engineQuery.error.message}
            </div>
          )}

          {/* R42 — print/export report controls. print:hidden so the
              buttons themselves never appear in the printed output. */}
          {result && (
            <div className="print:hidden flex items-center gap-3 text-caption">
              <button
                type="button"
                onClick={() => handlePrint("basic")}
                className="text-muted hover:text-secondary underline"
              >
                Print Chart &amp; Table
              </button>
              <button
                type="button"
                onClick={() => handlePrint("fancy")}
                className="text-muted hover:text-secondary underline"
              >
                Print Full Report
              </button>
            </div>
          )}

          {/* Fancy-report-only header — mounted only in "fancy" mode, hidden
              on screen, print-visible. */}
          {reportMode === "fancy" && (
            <div className="hidden print:block">
              <ReportHeader
                peopleNames={(people ?? enginePeople ?? []).map((p) => p.name)}
                generatedAt={new Date()}
              />
            </div>
          )}

          {/* ── CONTENT BLOCK ────────────────────────────────────────────────
               Every section renders a skeleton or real content at the SAME
               DOM position so the layout never shifts during loading. */}
          {(engineQuery.isLoading || !!result) && (
            <div className="space-y-4">
              {/* Hero KPIs (headline numbers) — always shown on screen;
                  print-visible only in the "fancy" report tier (basic tier
                  prints just the chart+table, per R42 scope). */}
              <div
                className={reportMode === "fancy" ? undefined : "print:hidden"}
              >
                {engineQuery.isLoading ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="min-h-[128px] animate-pulse rounded-lg border border-subtle bg-surface-primary/40 p-3"
                        style={{
                          animationDelay: `${i * 80}ms`,
                          animationDuration: "1.8s",
                        }}
                      >
                        <div className="h-2.5 w-20 rounded bg-surface-strong/20" />
                        <div className="mt-4 h-8 w-24 rounded bg-surface-strong/20" />
                        <div className="mt-2 h-2 w-16 rounded bg-surface-strong/20" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ProjectionHeroKpis state={state} />
                )}
              </div>

              {/* MC auto-load disabled notice — only when real data */}
              {result && !mcAutoloadEnabled && !mcPrefetchQuery.data && (
                <div className="print:hidden flex items-center justify-between rounded-lg border border-subtle bg-surface-sunken px-3 py-2">
                  <span className="text-xs text-muted">
                    Simulation auto-load is off — chart bands unavailable.
                  </span>
                  <button
                    onClick={() => runMonteCarlo()}
                    className="text-xs text-blue-500 hover:text-blue-400 font-medium"
                  >
                    Run Simulation
                  </button>
                </div>
              )}

              {/* MC assumptions summary — only when real data */}
              {result && (
                <div className="print:hidden">
                  <McResultsSection state={state} />
                </div>
              )}

              {/* Toolbar — skeleton during engine load, real controls once data arrives */}
              {engineQuery.isLoading ? (
                <div
                  className="h-[70px] animate-pulse rounded-lg bg-surface-sunken"
                  style={{ animationDuration: "1.8s" }}
                />
              ) : null}

              {/* Unified toolbar — two rows (only when real data). Row 1
                  = compute-time inputs (what to run), Row 2 = display-time
                  lenses (how to show what's already computed). Both render
                  here (not inside the chart) so they stay visible/
                  interactive during engineQuery.isLoading and use one
                  consistent PillBtn/LabeledPillGroup/LabeledSelect
                  convention instead of four separate hand-rolled ones
                  (UI/UX pass, 2026-08-29 — advisor-reviewed plan). */}
              {result &&
                (() => {
                  const pp = people ?? enginePeople;
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
                  // showing a fallback age there would be the exact bug
                  // fixed 2026-08-30 (pill said "Age 37", hero card said
                  // "Age 47" for the same household), so that case still
                  // nulls out rather than falling back.
                  const coastFireMcData = coastFireMcQuery.data?.result;
                  const coastFireAge =
                    coastFireMcData?.status === "found"
                      ? coastFireMcData.coastFireAge
                      : coastFireMcData?.status === "already_coast"
                        ? null
                        : deterministicCoastFireAge;
                  const coastFireAvailable = deterministicCoastFireAge != null;
                  const hasMc = mcBandsByYear != null;
                  // hasIndividualAccountData computed once in
                  // use-projection-derived.ts — MC "Simple" tax mode (the
                  // default) collapses per-account balances into one
                  // fictional bucket server-side, so a scenario sourced
                  // from an MC result (Rate-Seeded, and any future
                  // Simple-tax-mode scenario) has NO real per-person data
                  // to filter by — offering Sean/Joanna views would
                  // silently show $0 everywhere instead of an honest "not
                  // available" (live-user finding, 2026-08-28).
                  const personViewDisabledTitle = hasIndividualAccountData
                    ? undefined
                    : "Per-person breakdown isn't available for this scenario — it uses Simple tax mode, which doesn't track individual accounts. Switch to Advanced tax mode or view Joint totals.";
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
                    <div className="print:hidden space-y-2">
                      {/* COMPUTE zone — decisions that change what gets
                          calculated. Scenario is the primary control
                          (bigger, colored active state); everything else
                          is secondary, below the dashed rule. */}
                      <ControlZone
                        tone="compute"
                        title="Compute"
                        why="what gets run"
                      >
                        <LabeledPillGroup
                          label="Scenario"
                          size="lg"
                          helpTip={
                            <HelpTip
                              maxWidth={380}
                              lines={[
                                "Active Plan: your plan as configured, with contributions continuing through retirement.",
                                coastFireAvailable
                                  ? `Coast FIRE (Age ${coastFireAge}): contributions zeroed from age ${coastFireAge} onward — the earliest age that still passes.`
                                  : "Coast FIRE (Age N): contributions zeroed from your Coast FIRE age onward — the earliest age that still passes. Not yet available.",
                                "Coast FIRE (Today): the SAME idea, but stopping right now instead of at the earliest passing age. Use this to see exactly what breaks (and when) if you stopped contributing today — often a shortfall in the years before 59½, which the passing-age view won't show since it's built to avoid it.",
                                'Coast FIRE (Custom): check any age you pick, not just the earliest passing one or today — pick an age and press "Check this age" to see whether it passes.',
                                "Initial Rate: an alternate simulation where year 1 of retirement spending is set from your Initial Withdrawal Rate setting × starting balance instead of your stated budget/override — your budget is ignored entirely for the starting point. Every year after that still runs your ACTIVE strategy's own ongoing rules (guardrails, decline schedule, etc.) unchanged — this only changes where the number starts, not how it evolves. Computed on demand (not preloaded in the background like Coast FIRE), so the first switch takes a few seconds.",
                              ]}
                            />
                          }
                        >
                          <PillBtn
                            size="lg"
                            tone="compute"
                            active={scenarioView === "baseline"}
                            onClick={() => setScenarioView("baseline")}
                            label="Active Plan"
                          />
                          <PillBtn
                            size="lg"
                            tone="compute"
                            active={scenarioView === "coastFire"}
                            onClick={() => {
                              if (coastFireAvailable)
                                setScenarioView("coastFire");
                            }}
                            label={
                              coastFireAvailable
                                ? `Coast FIRE (Age ${coastFireAge})`
                                : "Coast FIRE"
                            }
                            disabled={!coastFireAvailable}
                          />
                          <PillBtn
                            size="lg"
                            tone="compute"
                            active={scenarioView === "coastFireToday"}
                            onClick={() => {
                              if (coastFireAvailable)
                                setScenarioView("coastFireToday");
                            }}
                            label="Coast FIRE (Today)"
                            disabled={!coastFireAvailable}
                          />
                          <PillBtn
                            size="lg"
                            tone="compute"
                            active={scenarioView === "coastFireCustom"}
                            onClick={() => setScenarioView("coastFireCustom")}
                            label="Coast FIRE (Custom)"
                          />
                          <PillBtn
                            size="lg"
                            tone="compute"
                            active={scenarioView === "rateSeeded"}
                            onClick={() => setScenarioView("rateSeeded")}
                            label="Initial Rate"
                          />
                        </LabeledPillGroup>
                        {scenarioView === "coastFireCustom" &&
                          (() => {
                            const currentAge =
                              result?.projectionByYear[0]?.age ?? 0;
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
                            // position — e.g. produced "54" instead of "42"
                            // (live-user finding, 2026-08-30). Clamping now
                            // happens only in commitDraft, on blur or
                            // "Check this age".
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
                              <div className="flex items-center gap-2 text-sm bg-surface-sunken rounded-md px-2.5 py-1.5 -mt-1">
                                <label
                                  htmlFor="coast-fire-custom-age"
                                  className="text-caption text-muted"
                                >
                                  Check age
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
                                  className="w-16 text-sm border rounded px-1.5 py-0.5 tabular-nums"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    checkCoastFireCustomAge(commitDraft())
                                  }
                                  disabled={coastFireProbeLoading}
                                  className="px-2.5 py-1 rounded-md text-label font-semibold border border-subtle text-muted shadow-sm transition-colors hover:bg-surface-primary/80 disabled:opacity-50"
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
                          {pp && pp.length > 1 && (
                            <LabeledPillGroup label="View">
                              <PillBtn
                                active={personFilter === "all"}
                                onClick={() => setPersonFilter("all")}
                                label="Joint"
                              />
                              {pp.map((p) => (
                                <PillBtn
                                  key={p.id}
                                  active={personFilter === p.id}
                                  onClick={() => setPersonFilter(p.id)}
                                  label={p.name}
                                  disabled={!!personViewDisabledTitle}
                                  title={personViewDisabledTitle}
                                />
                              ))}
                            </LabeledPillGroup>
                          )}
                          {isMc && (
                            <>
                              <LabeledSelect
                                label="Preset"
                                value={mcPreset}
                                onChange={(e) =>
                                  setMcPreset(e.target.value as typeof mcPreset)
                                }
                                title="Simulation preset"
                                helpTip={
                                  <HelpTip
                                    maxWidth={420}
                                    lines={[
                                      <span key="det">
                                        <strong className="text-blue-300">
                                          Deterministic
                                        </strong>{" "}
                                        — Single fixed-rate projection using
                                        your configured return rates. Shows one
                                        possible future, no randomness.
                                      </span>,
                                      <span key="agg">
                                        <strong className="text-red-300">
                                          Aggressive
                                        </strong>{" "}
                                        — Full historical returns, 0.9× vol,
                                        high equity (95%→35%). Money Guy /
                                        Bogleheads &quot;age - 20&quot; bonds
                                        rule.
                                      </span>,
                                      <span key="def">
                                        <strong className="text-green-300">
                                          Default
                                        </strong>{" "}
                                        — Historical returns, standard vol,
                                        hybrid FIRE glide path (90%→50% floor).
                                        Vanguard TDF accumulation + Kitces
                                        rising equity.
                                      </span>,
                                      <span key="con">
                                        <strong className="text-amber-300">
                                          Conservative
                                        </strong>{" "}
                                        — Forward-looking returns (~5% equity),
                                        +15% vol, heavy bonds (75%→15%).
                                        Vanguard VCMM / JP Morgan LTCMA.
                                      </span>,
                                      <span key="cus">
                                        <strong className="text-purple-300">
                                          Custom
                                        </strong>{" "}
                                        — Raw DB values for returns, volatility,
                                        and glide path. No preset adjustments —
                                        edit asset_class_params and
                                        glide_path_allocations directly.
                                      </span>,
                                    ]}
                                  />
                                }
                              >
                                <option value="aggressive">Aggressive</option>
                                <option value="default">Default</option>
                                <option value="conservative">
                                  Conservative
                                </option>
                                <option value="custom">Custom</option>
                              </LabeledSelect>
                              <LabeledSelect
                                label="Trials"
                                value={mcTrials}
                                onChange={(e) =>
                                  setMcTrials(Number(e.target.value))
                                }
                                title="Number of simulation trials"
                              >
                                <option value={500}>500</option>
                                <option value={1000}>1,000</option>
                                <option value={2500}>2,500</option>
                                <option value={5000}>5,000</option>
                              </LabeledSelect>
                              <LabeledPillGroup
                                label="Tax Mode"
                                helpTip={
                                  <HelpTip
                                    maxWidth={360}
                                    lines={[
                                      <span key="simple">
                                        <strong className="text-blue-300">
                                          Simple
                                        </strong>{" "}
                                        — Single portfolio, no tax. Comparable
                                        to cFIREsim/FireCalc.
                                      </span>,
                                      <span key="advanced">
                                        <strong className="text-orange-300">
                                          Advanced
                                        </strong>{" "}
                                        — Full multi-account tax-aware
                                        simulation with gross-up and bracket
                                        filling.
                                      </span>,
                                    ]}
                                  />
                                }
                              >
                                <PillBtn
                                  active={mcTaxMode === "simple"}
                                  onClick={() => setMcTaxMode("simple")}
                                  label="Simple"
                                />
                                <PillBtn
                                  active={mcTaxMode === "advanced"}
                                  onClick={() => setMcTaxMode("advanced")}
                                  label="Advanced"
                                />
                              </LabeledPillGroup>
                              <button
                                type="button"
                                onClick={() => setShowMethodology(true)}
                                className="text-caption text-blue-500 hover:text-blue-600 underline whitespace-nowrap"
                              >
                                How does this work?
                              </button>
                            </>
                          )}
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
                                    <div className="text-caption text-muted italic mt-0.5">
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
                                    <div className="text-xs text-faint mt-0.5">
                                      Use when:
                                    </div>
                                    <ul
                                      className="text-xs text-faint ml-3 space-y-0.5"
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
                                    className="border-t pt-1.5 text-xs text-faint italic"
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
                  if MC is still pending after engine completes) */}
              {engineQuery.isLoading ? (
                <ProjectionChartSkeleton phase="engine" />
              ) : chartView === "strategy" || chartView === "budget" ? (
                <SpendingStabilityChart state={state} view={chartView} />
              ) : mcChartPending && chartView === "balance" ? (
                <ProjectionChartSkeleton phase="simulation" />
              ) : (
                <ProjectionChart state={state} />
              )}
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
            // !== "disabled" guards below) — must mirror coastFireMcQuery's
            // own `enabled` condition in use-projection-queries.ts exactly,
            // or this shows "disabled" while the query is actually running
            // (selected but not yet autoloaded), or vice versa.
            const coastFireMcQueryEnabled =
              coastFireMcAutoloadEnabled ||
              scenarioView === "coastFire" ||
              scenarioView === "coastFireToday";
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
              real table otherwise. Same DOM position always. */}
          {engineQuery.isLoading || (!autoloadEnabled && !engineQuery.data) ? (
            <ProjectionTableSkeleton />
          ) : (
            <ProjectionTable
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
          )}

          {/* Fancy-report-only "behind the scenes" assumptions + footer —
              mounted only in "fancy" mode, hidden on screen, print-visible.
              Placed right after the table so it reads as the report's
              closing section rather than interrupting the chart/table. */}
          {reportMode === "fancy" && (
            <div className="hidden print:block">
              <ReportAssumptionsSummary
                settings={engineSettings}
                rmdExcessYears={
                  result?.projectionByYear.filter(
                    (y) =>
                      y.phase === "decumulation" &&
                      (y.rmdExcessAmount ?? 0) > 0.01,
                  ).length ?? 0
                }
                qcdYears={
                  result?.projectionByYear.filter(
                    (y) =>
                      y.phase === "decumulation" && (y.qcdAmount ?? 0) > 0.01,
                  ).length ?? 0
                }
              />
              <ReportFooter generatedAt={new Date()} />
            </div>
          )}

          {/* DECUMULATION DEFAULTS */}
          <div className="print:hidden">
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
              activeSpendingStrategy={engineSettings?.withdrawalStrategy}
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
                // No early-return gate on `result` at this component's top
                // level (unlike ProjectionChart/HeroKpis/McDepletionCallout),
                // so engineSettings isn't guaranteed defined here the way
                // the discriminated-return invariant covers those — fall
                // back to no deflation rather than asserting with `!`.
                const termYear = engineSettings
                  ? baseYear +
                    (engineSettings.endAge -
                      (result?.projectionByYear[0]?.age ?? 0))
                  : baseYear;
                return deflate(amount, termYear);
              }}
            />
          )}
      </SlidePanel>
    </>
  );
}
