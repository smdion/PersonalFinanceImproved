import dynamic from "next/dynamic";
import { SlidePanel } from "@/components/ui/slide-panel";
import { ValidationContent } from "@/components/methodology/validation-content";
import { SimulationAssumptions } from "@/components/retirement-projection/simulation/mc-simulation-assumptions";
import type { DollarBasis } from "@/lib/config/enum-values";
import { simulationDollars } from "@/lib/pure/simulation/dollars";
import type { ProjectionState } from "../projection-table-types";

// The methodology write-ups (~1,900 lines of prose) load only when one of
// their slide panels is opened (closed panels render nothing).
const MethodologyContent = dynamic(() =>
  import("@/components/methodology/methodology-content").then((m) => ({
    default: m.MethodologyContent,
  })),
);
const AccumulationMethodologyContent = dynamic(() =>
  import("@/components/methodology/accumulation-content").then((m) => ({
    default: m.AccumulationMethodologyContent,
  })),
);
const DecumulationMethodologyContent = dynamic(() =>
  import("@/components/methodology/decumulation-content").then((m) => ({
    default: m.DecumulationMethodologyContent,
  })),
);

export function ProjectionSlidePanels({
  state,
  dollarMode,
}: {
  state: ProjectionState;
  dollarMode: DollarBasis;
}) {
  const {
    showMethodology,
    setShowMethodology,
    showAccumMethodology,
    setShowAccumMethodology,
    showDecumMethodology,
    setShowDecumMethodology,
    showValidation,
    setShowValidation,
    showAssumptions,
    setShowAssumptions,
    mcQuery,
    setSimulationAssetClassOverrides,
    updateAssetClassOverrides,
    simulationAssetClassOverrides,
    fanBandRange,
    updateGlidePath,
    updateInflationOverrides,
    updateClampBounds,
  } = state;
  return (
    <>
      <SlidePanel
        isOpen={showMethodology}
        onClose={() => setShowMethodology(false)}
        title="Simulation Methodology"
      >
        <MethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showAccumMethodology}
        onClose={() => setShowAccumMethodology(false)}
        title="Accumulation Methodology"
      >
        <AccumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showDecumMethodology}
        onClose={() => setShowDecumMethodology(false)}
        title="Decumulation Methodology"
      >
        <DecumulationMethodologyContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showValidation}
        onClose={() => setShowValidation(false)}
        title="Why Trust These Numbers?"
      >
        <ValidationContent />
      </SlidePanel>
      <SlidePanel
        isOpen={showAssumptions}
        onClose={() => setShowAssumptions(false)}
        title="Simulation Assumptions"
      >
        {mcQuery.data?.result && "simulationInputs" in mcQuery.data && (
          <SimulationAssumptions
            inputs={mcQuery.data.simulationInputs}
            numTrials={mcQuery.data.result.numTrials}
            onAssetClassOverridesChange={(overrides) => {
              setSimulationAssetClassOverrides(overrides);
              updateAssetClassOverrides.mutate(overrides);
            }}
            assetClassOverrides={simulationAssetClassOverrides}
            fanBandRange={fanBandRange}
            onGlidePathChange={(entries) => updateGlidePath.mutate({ entries })}
            onInflationRiskChange={(stdDev) =>
              updateInflationOverrides.mutate({ stdDev })
            }
            onClampBoundsChange={(min, max) =>
              updateClampBounds.mutate({
                preset: "custom",
                returnClampMin: min,
                returnClampMax: max,
              })
            }
            outcomeDistribution={{
              successRate: mcQuery.data.result.successRate,
              ...simulationDollars(mcQuery.data.result, dollarMode),
              sustainableWithdrawalPV:
                mcQuery.data.result.distributions.sustainableWithdrawalPV,
              failureAge:
                mcQuery.data.result.distributions.failureAge ?? undefined,
              computeTimeMs: mcQuery.data.result.computeTimeMs,
            }}
          />
        )}
      </SlidePanel>
    </>
  );
}
