/** The loader: the run-it-yourself card when autoload is off, or the slim
 *  strip while the simulation or Coast FIRE still runs. */
import { ProjectionLoader } from "../projection-loader";
import type { ProjectionState } from "../projection-table-types";

export function ProjectionLoaderStrip({ state }: { state: ProjectionState }) {
  const {
    engineQuery,
    mcPrefetchQuery,
    mcAutoloadEnabled,
    coastFireSimulationQueryEnabled,
    coastFireSimulationQuery,
    autoloadEnabled,
    runSimulation,
    runMonteCarlo,
    runCoastFireSimulation,
  } = state;
  const enginePhase = engineQuery.isLoading
    ? ("active" as const)
    : engineQuery.isSuccess
      ? ("done" as const)
      : ("pending" as const);

  const simulationInitialLoading =
    !mcPrefetchQuery.data && mcPrefetchQuery.isFetching;
  const simulationPhase = !mcAutoloadEnabled
    ? ("disabled" as const)
    : simulationInitialLoading
      ? ("active" as const)
      : mcPrefetchQuery.data
        ? ("done" as const)
        : ("pending" as const);

  // "disabled" hides the strip. coastFireSimulationQueryEnabled is the value that
  // gates coastFireSimulationQuery itself, so the two always agree.
  const coastFireSimulationPhase = !coastFireSimulationQueryEnabled
    ? ("disabled" as const)
    : coastFireSimulationQuery.isLoading || coastFireSimulationQuery.isFetching
      ? ("active" as const)
      : coastFireSimulationQuery.data
        ? ("done" as const)
        : ("pending" as const);

  const showActionState =
    !autoloadEnabled && !engineQuery.data && !engineQuery.isLoading;

  return (
    <div className="print:hidden">
      <ProjectionLoader
        enginePhase={enginePhase}
        simulationPhase={simulationPhase}
        coastFireSimulationPhase={coastFireSimulationPhase}
        showActionState={showActionState}
        onRunSimulation={runSimulation}
        onRunMonteCarlo={runMonteCarlo}
        onRunCoastFireSimulation={runCoastFireSimulation}
      />
    </div>
  );
}
