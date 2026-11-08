import type { SimulationInputs } from "./mc-simulation-types";
import { HelpTip } from "@/components/ui/help-tip";
import { AssumptionRow } from "./assumption-row";

export type PresetMultipliersProps = {
  inputs: SimulationInputs;
};

export function PresetMultipliers({ inputs }: PresetMultipliersProps) {
  return (
    <>
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
    </>
  );
}
