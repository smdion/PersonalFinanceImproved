"use client";

import type {
  SimulationInputs,
  AssetClassOverride,
  OutcomeDistribution,
} from "./mc-simulation-types";
import { ReturnClampSection } from "./mc-bounds";
import { OutcomeDistributionPanel } from "./mc-outcome-distribution";
import { AssumptionsOverview } from "./mc-assumptions-overview";
import { ScenarioInputs } from "./mc-scenario-section";
import { AssetClassSection } from "./mc-asset-class-section";
import { GlidePathSection } from "./mc-glide-path-section";
import { CorrelationSection } from "./mc-correlation-section";
import { AssumptionsToggle } from "./mc-assumptions-toggle";
import { PresetMultipliers } from "./mc-preset-multipliers";
import { useSimulationAssumptionDrafts } from "./use-simulation-assumption-drafts";

export function SimulationAssumptions({
  inputs,
  numTrials,
  onAssetClassOverridesChange,
  assetClassOverrides,
  fanBandRange = "p25-p75",
  onGlidePathChange,
  onInflationRiskChange,
  onClampBoundsChange,
  outcomeDistribution,
}: {
  inputs: SimulationInputs;
  numTrials: number;
  onAssetClassOverridesChange?: (overrides: AssetClassOverride[]) => void;
  assetClassOverrides?: AssetClassOverride[];
  fanBandRange?: "off" | "p25-p75" | "p10-p90" | "p5-p95";
  onGlidePathChange?: (
    entries: { age: number; allocations: Record<number, number> }[],
  ) => void;
  onInflationRiskChange?: (stdDev: number) => void;
  onClampBoundsChange?: (min: number, max: number) => void;
  outcomeDistribution?: OutcomeDistribution;
}) {
  const {
    expanded,
    setExpanded,
    editing,
    draftReturns,
    setDraftReturns,
    draftVols,
    setDraftVols,
    editingGlidePath,
    setEditingGlidePath,
    draftGlidePath,
    setDraftGlidePath,
    editingInflation,
    setEditingInflation,
    draftInflStdDev,
    setDraftInflStdDev,
    editingClamps,
    setEditingClamps,
    draftClampMin,
    setDraftClampMin,
    draftClampMax,
    setDraftClampMax,
    startEditing,
    cancelEditing,
    applyEdits,
    resetOverrides,
    hasOverrides,
    activeOverrides,
    presetColors,
  } = useSimulationAssumptionDrafts(
    inputs,
    onAssetClassOverridesChange,
    assetClassOverrides,
  );

  return (
    <div className="bg-surface-sunken rounded-lg border">
      <AssumptionsToggle
        activeOverrides={activeOverrides}
        expanded={expanded}
        setExpanded={setExpanded}
      />

      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          <AssumptionsOverview
            activeOverrides={activeOverrides}
            fanBandRange={fanBandRange}
            inputs={inputs}
            numTrials={numTrials}
            presetColors={presetColors}
          />

          {/* Key scenario inputs — 2 columns on mobile, 4 on desktop */}
          <ScenarioInputs
            draftInflStdDev={draftInflStdDev}
            editingInflation={editingInflation}
            inputs={inputs}
            numTrials={numTrials}
            onInflationRiskChange={onInflationRiskChange}
            setDraftInflStdDev={setDraftInflStdDev}
            setEditingInflation={setEditingInflation}
          />

          {/* Asset classes */}
          <AssetClassSection
            applyEdits={applyEdits}
            assetClassOverrides={assetClassOverrides}
            cancelEditing={cancelEditing}
            draftReturns={draftReturns}
            draftVols={draftVols}
            editing={editing}
            hasOverrides={hasOverrides}
            inputs={inputs}
            onAssetClassOverridesChange={onAssetClassOverridesChange}
            resetOverrides={resetOverrides}
            setDraftReturns={setDraftReturns}
            setDraftVols={setDraftVols}
            startEditing={startEditing}
          />

          {/* Glide path table */}
          <GlidePathSection
            draftGlidePath={draftGlidePath}
            editingGlidePath={editingGlidePath}
            inputs={inputs}
            onGlidePathChange={onGlidePathChange}
            setDraftGlidePath={setDraftGlidePath}
            setEditingGlidePath={setEditingGlidePath}
          />

          {/* Preset multipliers */}
          <PresetMultipliers inputs={inputs} />

          {/* Return clamp bounds */}
          <ReturnClampSection
            draftClampMax={draftClampMax}
            draftClampMin={draftClampMin}
            editingClamps={editingClamps}
            inputs={inputs}
            onClampBoundsChange={onClampBoundsChange}
            setDraftClampMax={setDraftClampMax}
            setDraftClampMin={setDraftClampMin}
            setEditingClamps={setEditingClamps}
          />

          {/* Correlation matrix */}
          <CorrelationSection inputs={inputs} />
        </div>
      )}

      {/* Outcome Distribution — detail metrics moved here from inline KPIs */}
      <OutcomeDistributionPanel outcomeDistribution={outcomeDistribution} />
    </div>
  );
}
