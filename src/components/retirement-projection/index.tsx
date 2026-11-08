"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect } from "react";
import type { DollarBasis } from "@/lib/config/enum-values";
import { OverridesPanel } from "./overrides-panel";
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
import { ReportControls } from "./projection-card/report-controls";
import { ChartArea } from "./projection-card/chart-area";
import { TableArea } from "./projection-card/table-area";
import { McResultsSection } from "./projection-mc-results";
import {
  useProjectionState,
  type EngineContribRate,
} from "./use-projection-state";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type ProjectionCardProps = {
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
  /** The Retirement Profile the AssumptionsBand above shows, threaded to
   *  every engine query so the chart and table agree with it. */
  retirementProfileId?: number | null;
  snapshotId?: number;
  /** When provided, overrides the internal dollarMode state (for shared page-level toggle). */
  dollarMode?: DollarBasis;
  onDollarModeChange?: (mode: DollarBasis) => void;
};

export function ProjectionCard(props: ProjectionCardProps) {
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

  const {
    dollarMode: internalDollarMode,
    setDollarMode: internalSetDollarMode,
    chartView,
    setChartView,
    setPersonFilter,
    isPersonFiltered,
    engineQuery,
    mcPrefetchQuery,
    mcChartPending,
    result,
    hasIndividualAccountData,
    engineSettings,
    autoloadEnabled,
    mcAutoloadEnabled,
    runMonteCarlo,
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
  const report = useProjectionReport(state);

  return (
    <>
      <RecalculatingBanner state={state} />
      <div className="mb-6 space-y-6">
        <div className="space-y-6">
          <EngineNotices engineQuery={engineQuery} />

          <ReportControls state={state} people={people} report={report} />

          {/* Each section renders its skeleton or content at the same DOM
              position, so the layout never shifts while loading. */}
          {(engineQuery.isLoading || !!result) && (
            <div className="space-y-4">
              {/* Hero KPIs (headline numbers) — always shown on screen;
                  print-visible only in the "advisor" report tier (basic
                  tier prints just the chart+table). */}
              <HeroKpisPanel
                reportMode={report.reportMode}
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

              {/* The toolbar, once there is a result: Compute (what to run)
                  and Display (how to show it), outside the chart so it
                  stays usable while the engine loads. */}
              {result && (
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
              )}

              {/* Chart area — engine skeleton, then real chart (with MC skeleton
                  if MC is still pending after engine completes). The advisor
                  report is a purpose-built document, not a printout of the
                  interactive chart — print:hidden whenever "advisor" mode
                  is active. */}
              <ChartArea
                reportMode={report.reportMode}
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
            reportMode={report.reportMode}
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
          <DecumulationPanel state={state} />

          {/* UNIFIED OVERRIDES */}
          <div className="print:hidden">
            <OverridesPanel
              state={state}
              accumulationExpenseOverride={accumulationExpenseOverride}
            />
          </div>
        </div>
      </div>
      <ProjectionSlidePanels state={state} dollarMode={dollarMode} />
    </>
  );
}
