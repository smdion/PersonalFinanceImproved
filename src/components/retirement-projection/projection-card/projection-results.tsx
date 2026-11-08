import type { DollarBasis } from "@/lib/config/enum-values";
import type { ProjectionState } from "../projection-table-types";
import { McResultsSection } from "../projection-mc-results";
import { SimulationOffNotice } from "./engine-notices";
import { HeroKpisPanel } from "./hero-panel";
import { ComputeControls } from "./compute-controls";
import { DisplayControls } from "./display-controls";
import { ChartArea } from "./chart-area";
import type { useProjectionReport } from "./use-projection-report";

export function ProjectionResults({
  report,
  state,
  people,
  dollarMode,
  setDollarMode,
}: {
  report: ReturnType<typeof useProjectionReport>;
  state: ProjectionState;
  people: { id: number; name: string }[] | undefined;
  dollarMode: DollarBasis;
  setDollarMode: (mode: DollarBasis) => void;
}) {
  const {
    engineQuery,
    result,
    engineSettings,
    mcAutoloadEnabled,
    mcPrefetchQuery,
    runMonteCarlo,
    chartView,
    setChartView,
    mcChartPending,
  } = state;
  return (
    <>
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
                result={result}
                engineSettings={engineSettings}
                people={people}
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
    </>
  );
}
