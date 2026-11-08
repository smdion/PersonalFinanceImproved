import type { SimulationInputs } from "./mc-simulation-types";
import { HelpTip } from "@/components/ui/help-tip";
import { correlationMatrix } from "./mc-bounds";

export type CorrelationSectionProps = {
  inputs: SimulationInputs;
};

export function CorrelationSection({ inputs }: CorrelationSectionProps) {
  return (
    <>
      {inputs.correlations.length > 0 && (
        <div>
          <div className="text-label text-muted mb-1 font-medium">
            Asset Class Correlations
            <HelpTip text="Pairwise correlations used to generate correlated random returns across asset classes each simulation year. Values range from -1 (perfectly inverse) to +1 (perfectly correlated)." />
          </div>
          {correlationMatrix(inputs)}
        </div>
      )}
    </>
  );
}
