"use client";

/** Top-level ProjectionCard component — orchestrates the projection state hook and delegates to sub-components. */
import { useEffect } from "react";
import type { DollarBasis } from "@/lib/config/enum-values";
import { OverridesPanel } from "./overrides-panel";
import { EngineNotices } from "./projection-card/engine-notices";
import { RecalculatingBanner } from "./projection-card/recalculating-banner";
import { ProjectionLoaderStrip } from "./projection-card/loader-strip";
import { DecumulationPanel } from "./projection-card/decumulation-panel";
import { ProjectionSlidePanels } from "./projection-card/slide-panels";
import { useProjectionReport } from "./projection-card/use-projection-report";
import { ReportControls } from "./projection-card/report-controls";
import { ProjectionResults } from "./projection-card/projection-results";
import { TableArea } from "./projection-card/table-area";
import {
  useProjectionState,
  type EngineContributionRate,
} from "./use-projection-state";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type ProjectionCardProps = {
  people?: { id: number; name: string; birthYear: number }[];
  onContributionRates?: (rates: EngineContributionRate[]) => void;
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
    setPersonFilter,
    isPersonFiltered,
    engineQuery,
    result,
    hasIndividualAccountData,
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
          <ProjectionResults
            report={report}
            state={state}
            people={people}
            dollarMode={dollarMode}
            setDollarMode={setDollarMode}
          />

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
