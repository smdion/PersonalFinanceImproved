import dynamic from "next/dynamic";
import { ProjectionChartSkeleton } from "../projection-chart-skeleton";
import type { ProjectionState, ReportMode } from "../projection-table-types";

// Code-split Recharts-heavy children. Each chart is
// ~250KB of recharts payload that loads only when the projection card mounts.
// ssr:false because Recharts isn't SSR-friendly.
const ProjectionChart = dynamic(
  () =>
    import("../projection-chart").then((m) => ({ default: m.ProjectionChart })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);
const SpendingStabilityChart = dynamic(
  () =>
    import("../spending-stability-chart").then((m) => ({
      default: m.SpendingStabilityChart,
    })),
  { loading: () => <ProjectionChartSkeleton />, ssr: false },
);

export function ChartArea({
  reportMode,
  engineQuery,
  chartView,
  state,
  mcChartPending,
}: {
  reportMode: ReportMode;
  engineQuery: ProjectionState["engineQuery"];
  chartView: ProjectionState["chartView"];
  state: ProjectionState;
  mcChartPending: ProjectionState["mcChartPending"];
}) {
  return (
    <div className={reportMode === "advisor" ? "print:hidden" : undefined}>
      {engineQuery.isLoading ? (
        <ProjectionChartSkeleton phase="engine" />
      ) : chartView === "strategy" || chartView === "budget" ? (
        <SpendingStabilityChart state={state} view={chartView} />
      ) : mcChartPending ? (
        <ProjectionChartSkeleton phase="simulation" />
      ) : (
        <ProjectionChart state={state} />
      )}
      {engineQuery.data &&
        "jobYearsNote" in engineQuery.data &&
        engineQuery.data.jobYearsNote && (
          <p className="text-caption text-faint mt-1">
            {engineQuery.data.jobYearsNote}
          </p>
        )}
    </div>
  );
}
