"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
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
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);

  // Local draft state for editing asset class params (keyed by asset class id)
  const [draftReturns, setDraftReturns] = useState<Record<number, string>>({});
  const [draftVols, setDraftVols] = useState<Record<number, string>>({});

  // Glide path edit state (allocations keyed by asset class id)
  const [editingGlidePath, setEditingGlidePath] = useState(false);
  const [draftGlidePath, setDraftGlidePath] = useState<
    { age: number; allocations: Record<number, string> }[]
  >([]);

  // Inflation risk edit state
  const [editingInflation, setEditingInflation] = useState(false);
  const [draftInflStdDev, setDraftInflStdDev] = useState("");

  // Clamp bounds edit state
  const [editingClamps, setEditingClamps] = useState(false);
  const [draftClampMin, setDraftClampMin] = useState("");
  const [draftClampMax, setDraftClampMax] = useState("");

  const startEditing = () => {
    const returns: Record<number, string> = {};
    const vols: Record<number, string> = {};
    for (const ac of inputs.assetClasses) {
      returns[ac.id] = (ac.meanReturn * 100).toFixed(1);
      vols[ac.id] = (ac.stdDev * 100).toFixed(1);
    }
    setDraftReturns(returns);
    setDraftVols(vols);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const applyEdits = () => {
    if (!onAssetClassOverridesChange) return;
    const overrides: AssetClassOverride[] = [];
    for (const ac of inputs.assetClasses) {
      const newReturn = parseFloat(draftReturns[ac.id] ?? "");
      const newVol = parseFloat(draftVols[ac.id] ?? "");
      const hasReturnChange =
        !isNaN(newReturn) && Math.abs(newReturn / 100 - ac.meanReturn) > 0.0001;
      const hasVolChange =
        !isNaN(newVol) && Math.abs(newVol / 100 - ac.stdDev) > 0.0001;
      if (hasReturnChange || hasVolChange) {
        overrides.push({
          id: ac.id,
          meanReturn: hasReturnChange ? newReturn / 100 : undefined,
          stdDev: hasVolChange ? newVol / 100 : undefined,
        });
      }
    }
    onAssetClassOverridesChange(overrides);
    setEditing(false);
  };

  const resetOverrides = () => {
    if (onAssetClassOverridesChange) {
      onAssetClassOverridesChange([]);
    }
    setEditing(false);
  };

  const hasOverrides = assetClassOverrides && assetClassOverrides.length > 0;

  // Collect active override indicators
  const activeOverrides: string[] = [];
  if (hasOverrides)
    activeOverrides.push("Asset class return/vol manually adjusted");
  if (inputs.accumulationExpenseOverride != null)
    activeOverrides.push(
      `Pre-retirement spending set to ${formatCurrency(inputs.accumulationExpenseOverride)}/yr`,
    );
  if (inputs.decumulationExpenseOverride != null)
    activeOverrides.push(
      `Retirement spending set to ${formatCurrency(inputs.decumulationExpenseOverride)}/yr`,
    );

  const presetColors: Record<string, string> = {
    aggressive: "text-red-600 bg-red-50 border-red-200",
    default: "text-blue-600 bg-blue-50 border-blue-200",
    conservative: "text-green-700 bg-green-50 border-green-200",
    custom: "text-purple-600 bg-purple-50 border-purple-200",
  };

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
