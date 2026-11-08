"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect } from "react";
import type { DollarBasis } from "@/lib/config/enum-values";
import { OverridesPanel } from "./overrides-panel";
import { ReportRoot } from "./report/report-root";
import {
  EngineNotices,
  SimulationOffNotice,
} from "./projection-card/engine-notices";
import { HeroKpisPanel } from "./projection-card/hero-panel";
import { ComputeControls } from "./projection-card/compute-controls";
import { DisplayControls } from "./projection-card/display-controls";
import { RecalculatingBanner } from "./projection-card/recalculating-banner";
import { ProjectionLoaderStrip } from "./projection-card/loader-strip";
import { DecumulationPanel } from "./projection-card/decumulation-panel";
import { ProjectionSlidePanels } from "./projection-card/slide-panels";
import { useProjectionReport } from "./projection-card/use-projection-report";
import { ChartArea } from "./projection-card/chart-area";
import { TableArea } from "./projection-card/table-area";
import { ReportGateModal } from "./report/report-gate-modal";
import { McResultsSection } from "./projection-mc-results";
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
    mcTaxMode,
    mcAssetClassOverrides,
    setMcAssetClassOverrides,
    dollarMode: internalDollarMode,
    setDollarMode: internalSetDollarMode,
    chartView,
    setChartView,
    fanBandRange,
    scenarioView,
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
    mcAutoloadEnabled,
    runMonteCarlo,
    coastFireAge: deterministicCoastFireAge,
    bracketOptimizerResult,
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
  const {
    reportMode,
    gateFailure,
    setGateFailure,
    handlePrint,
    handlePrintAdvisor,
  } = useProjectionReport(
    state,
    scenarioView,
    mcTaxMode,
    sharedInput,
    debouncedInput,
    engineQuery,
    mcQuery,
  );

  return (
    <>
      <RecalculatingBanner state={state} />
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
                  return (
                    <div className="space-y-2 print:hidden">
                      {/* COMPUTE zone — decisions that change what gets
                          calculated. Scenario is the primary control
                          (bigger, colored active state); everything else
                          is secondary, below the dashed rule. */}
                      <ComputeControls
                        state={state}
                        people={people}
                        result={result}
                        engineSettings={engineSettings}
                      />

                      {/* DISPLAY zone — lenses on results already computed.
                          Chart type is the primary control; Dollars rides
                          alongside it since it's the other frequently-
                          touched one. Everything else is secondary. */}
                      <DisplayControls
                        chartView={chartView}
                        setChartView={setChartView}
                        dollarMode={dollarMode}
                        setDollarMode={setDollarMode}
                        state={state}
                      />
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
          <ProjectionLoaderStrip state={state} />

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
          <DecumulationPanel
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
            engineSettings={engineSettings}
            withdrawalSplits={withdrawalSplits}
            setWithdrawalSplits={setWithdrawalSplits}
            withdrawalSplitsTouched={withdrawalSplitsTouched}
            withdrawalTaxPref={withdrawalTaxPref}
            setWithdrawalTaxPref={setWithdrawalTaxPref}
          />

          {/* UNIFIED OVERRIDES */}
          <div className="print:hidden">
            <OverridesPanel
              state={state}
              accumulationExpenseOverride={accumulationExpenseOverride}
            />
          </div>
        </div>
      </div>
      <ProjectionSlidePanels
        showMethodology={showMethodology}
        setShowMethodology={setShowMethodology}
        showAccumMethodology={showAccumMethodology}
        setShowAccumMethodology={setShowAccumMethodology}
        showDecumMethodology={showDecumMethodology}
        setShowDecumMethodology={setShowDecumMethodology}
        showValidation={showValidation}
        setShowValidation={setShowValidation}
        showAssumptions={showAssumptions}
        setShowAssumptions={setShowAssumptions}
        mcQuery={mcQuery}
        setMcAssetClassOverrides={setMcAssetClassOverrides}
        updateAssetClassOverrides={updateAssetClassOverrides}
        mcAssetClassOverrides={mcAssetClassOverrides}
        fanBandRange={fanBandRange}
        updateGlidePath={updateGlidePath}
        updateInflationOverrides={updateInflationOverrides}
        updateClampBounds={updateClampBounds}
        dollarMode={dollarMode}
      />
    </>
  );
}
