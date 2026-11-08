import { HelpTip } from "@/components/ui/help-tip";
import type { DollarBasis } from "@/lib/config/enum-values";
import { PillBtn, LabeledPillGroup, ControlZone } from "../pill-btn";
import type { ProjectionState } from "../projection-table-types";
import { DollarsPills } from "./dollars-pills";
import { DisplaySecondaryRow } from "./display-secondary-row";

export function DisplayControls({
  chartView,
  setChartView,
  dollarMode,
  setDollarMode,
  state,
}: {
  chartView: ProjectionState["chartView"];
  setChartView: ProjectionState["setChartView"];
  dollarMode: DollarBasis;
  setDollarMode: (mode: DollarBasis) => void;
  state: ProjectionState;
}) {
  return (
    <ControlZone tone="display" title="Display" why="how it's shown">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LabeledPillGroup
          label="Chart"
          size="lg"
          helpTip={
            <HelpTip
              maxWidth={380}
              lines={[
                "Balance ($): your projected account balances over time, the main chart.",
                'Yearly Income Stability (%): a completely different chart, showing each year\'s spending as a % of a baseline instead of a dollar balance. Pick which baseline with "Compare vs" once selected.',
              ]}
            />
          }
        >
          <PillBtn
            size="lg"
            tone="display"
            active={chartView === "balance"}
            onClick={() => setChartView("balance")}
            label="Balance"
          />
          <PillBtn
            size="lg"
            tone="display"
            active={chartView !== "balance"}
            onClick={() => {
              if (chartView === "balance") setChartView("strategy");
            }}
            label="Yearly Income Stability"
          />
        </LabeledPillGroup>
        <DollarsPills dollarMode={dollarMode} setDollarMode={setDollarMode} />
      </div>
      <DisplaySecondaryRow state={state} />
    </ControlZone>
  );
}
