"use client";

import { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type {
  SimulationInputs,
  AssetClassOverride,
  OutcomeDistribution,
} from "./mc-simulation-types";
import { AssumptionRow } from "./assumption-row";
import { ReturnClampSection } from "./mc-bounds";
import { OutcomeDistributionPanel } from "./mc-outcome-distribution";
import { AssumptionsOverview } from "./mc-assumptions-overview";
import { ScenarioInputs } from "./mc-scenario-section";
import { AssetClassSection } from "./mc-asset-class-section";
import { GlidePathSection } from "./mc-glide-path-section";
import { CorrelationSection } from "./mc-correlation-section";

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
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-muted hover:bg-surface-elevated flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors"
      >
        <span className="font-medium">
          Simulation Assumptions
          {activeOverrides.length > 0 && (
            <span className="ml-1 text-amber-600">
              ({activeOverrides.length} set by you)
            </span>
          )}
        </span>
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

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
          {inputs.preset !== "custom" && (
            <div>
              <div className="text-label text-muted mb-1 font-medium">
                Preset Multipliers
                <HelpTip text="How the selected preset modifies the raw DB asset class values. Return multiplier scales expected returns; vol multiplier scales volatility." />
              </div>
              <div className="text-label grid grid-cols-2 gap-x-4 gap-y-0.5">
                <AssumptionRow
                  label="Return Multiplier"
                  value={`${inputs.returnMultiplier.toFixed(2)}×`}
                />
                <AssumptionRow
                  label="Volatility Multiplier"
                  value={`${inputs.volMultiplier.toFixed(2)}×`}
                />
              </div>
            </div>
          )}

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
