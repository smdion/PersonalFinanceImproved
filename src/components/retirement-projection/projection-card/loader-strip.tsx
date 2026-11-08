/** The loader: the run-it-yourself card when autoload is off, or the slim
 *  strip while the simulation or Coast FIRE still runs. */
import { ProjectionLoader } from "../projection-loader";
import type { ProjectionState } from "../projection-table-types";

export function ProjectionLoaderStrip({ state }: { state: ProjectionState }) {
  const {
    engineQuery,
    mcPrefetchQuery,
    mcAutoloadEnabled,
    coastFireMcQueryEnabled,
    coastFireMcQuery,
    autoloadEnabled,
    runSimulation,
    runMonteCarlo,
    runCoastFireMc,
  } = state;
  const enginePhase = engineQuery.isLoading
    ? ("active" as const)
    : engineQuery.isSuccess
      ? ("done" as const)
      : ("pending" as const);

  const mcInitialLoading = !mcPrefetchQuery.data && mcPrefetchQuery.isFetching;
  const mcPhase = !mcAutoloadEnabled
    ? ("disabled" as const)
    : mcInitialLoading
      ? ("active" as const)
      : mcPrefetchQuery.data
        ? ("done" as const)
        : ("pending" as const);

  // "disabled" hides the strip. coastFireMcQueryEnabled is the value that
  // gates coastFireMcQuery itself, so the two always agree.
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
}
