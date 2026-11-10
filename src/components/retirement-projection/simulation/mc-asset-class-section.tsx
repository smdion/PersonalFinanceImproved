import type {
  AssetClassOverride,
  SimulationInputs,
} from "./mc-simulation-types";
import { AssetClassTable } from "./mc-asset-classes";
import type { Dispatch, SetStateAction } from "react";

export type AssetClassSectionProps = {
  applyEdits: () => void;
  assetClassOverrides: AssetClassOverride[] | undefined;
  cancelEditing: () => void;
  draftReturns: Record<number, string>;
  draftVols: Record<number, string>;
  editing: boolean;
  hasOverrides: boolean | undefined;
  inputs: SimulationInputs;
  onAssetClassOverridesChange:
    ((overrides: AssetClassOverride[]) => void) | undefined;
  resetOverrides: () => void;
  setDraftReturns: Dispatch<SetStateAction<Record<number, string>>>;
  setDraftVols: Dispatch<SetStateAction<Record<number, string>>>;
  startEditing: () => void;
};

export function AssetClassSection({
  applyEdits,
  assetClassOverrides,
  cancelEditing,
  draftReturns,
  draftVols,
  editing,
  hasOverrides,
  inputs,
  onAssetClassOverridesChange,
  resetOverrides,
  setDraftReturns,
  setDraftVols,
  startEditing,
}: AssetClassSectionProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-label text-muted font-medium">
          Asset Classes (Return / Volatility)
          {hasOverrides && (
            <span className="ml-1 text-amber-600">(your own values)</span>
          )}
        </div>
        {onAssetClassOverridesChange && !editing && (
          <div className="flex gap-1.5">
            {hasOverrides && (
              <button
                type="button"
                onClick={resetOverrides}
                className="text-caption text-amber-600 underline hover:text-amber-800"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={startEditing}
              className="text-caption text-blue-600 underline hover:text-blue-800"
            >
              Edit
            </button>
          </div>
        )}
        {editing && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={cancelEditing}
              className="text-caption text-muted hover:text-secondary underline"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyEdits}
              className="text-caption font-medium text-blue-600 underline hover:text-blue-800"
            >
              Apply
            </button>
          </div>
        )}
      </div>
      <AssetClassTable
        assetClassOverrides={assetClassOverrides}
        draftReturns={draftReturns}
        draftVols={draftVols}
        editing={editing}
        inputs={inputs}
        setDraftReturns={setDraftReturns}
        setDraftVols={setDraftVols}
      />
    </div>
  );
}
