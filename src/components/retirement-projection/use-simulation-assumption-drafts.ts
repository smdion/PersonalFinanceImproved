import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import type {
  AssetClassOverride,
  SimulationInputs,
} from "./mc-simulation-types";

export function useSimulationAssumptionDrafts(
  inputs: SimulationInputs,
  onAssetClassOverridesChange:
    ((overrides: AssetClassOverride[]) => void) | undefined,
  assetClassOverrides: AssetClassOverride[] | undefined,
) {
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
  const [draftInflationStdDev, setDraftInflationStdDev] = useState("");

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
      `Budget set to ${formatCurrency(inputs.accumulationExpenseOverride)}/yr`,
    );
  if (inputs.decumulationExpenseOverride != null)
    activeOverrides.push(
      `Retirement budget set to ${formatCurrency(inputs.decumulationExpenseOverride)}/yr`,
    );

  const presetColors: Record<string, string> = {
    aggressive: "text-red-600 bg-red-50 border-red-200",
    default: "text-blue-600 bg-blue-50 border-blue-200",
    conservative: "text-green-700 bg-green-50 border-green-200",
    custom: "text-purple-600 bg-purple-50 border-purple-200",
  };

  return {
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
    draftInflationStdDev,
    setDraftInflationStdDev,
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
  };
}
