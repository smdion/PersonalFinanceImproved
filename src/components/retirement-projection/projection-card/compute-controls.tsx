/** The toolbar's Compute zone: what gets run. */
import { ControlZone, ZoneSecondaryRow } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";
import { ScenarioPills } from "./compute-zone";
import { CoastFireCustomAge } from "./coast-fire-custom-age";
import { PersonViewPills } from "./person-view-pills";
import { SimulationSettings } from "./simulation-settings";

export function ComputeControls({
  state,
  result,
  engineSettings,
  people,
}: {
  state: ProjectionState;
  result: NonNullable<ProjectionState["result"]>;
  engineSettings: NonNullable<ProjectionState["engineSettings"]>;
  people: { id: number; name: string }[] | undefined;
}) {
  const {
    projectionMode,
    projectionView,
    setProjectionView,
    coastFireMcQuery,
    coastFireAge: deterministicCoastFireAge,
  } = state;
  const isMc = projectionMode === "monteCarlo";
  // Availability comes from the deterministic age, which always runs (the
  // simulation's probe starts only once this scenario is picked); the label
  // prefers the simulated age once loaded, and none when already coasting.
  const coastFireMcData = coastFireMcQuery.data?.result;
  const coastFireAge =
    coastFireMcData?.status === "found"
      ? coastFireMcData.coastFireAge
      : coastFireMcData?.status === "already_coast"
        ? null
        : deterministicCoastFireAge;
  const coastFireAvailable = deterministicCoastFireAge != null;
  return (
    <ControlZone tone="compute" title="Compute" why="what gets run">
      <ScenarioPills
        coastFireAvailable={coastFireAvailable}
        state={state}
        coastFireAge={coastFireAge}
        projectionView={projectionView}
        setProjectionView={setProjectionView}
      />
      {projectionView === "coastFireCustom" && (
        <CoastFireCustomAge
          state={state}
          result={result}
          engineSettings={engineSettings}
        />
      )}
      <ZoneSecondaryRow>
        <PersonViewPills state={state} people={people} />
        {isMc && <SimulationSettings state={state} />}
      </ZoneSecondaryRow>
    </ControlZone>
  );
}
