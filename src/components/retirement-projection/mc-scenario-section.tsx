import type { SimulationInputs } from "./mc-simulation-types";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { AssumptionRow } from "./assumption-row";
import { InflationRiskRow, withdrawalRateRows } from "./mc-scenario-inputs";
import type { Dispatch, SetStateAction } from "react";

export type ScenarioInputsProps = {
  draftInflStdDev: string;
  editingInflation: boolean;
  inputs: SimulationInputs;
  numTrials: number;
  onInflationRiskChange: ((stdDev: number) => void) | undefined;
  setDraftInflStdDev: Dispatch<SetStateAction<string>>;
  setEditingInflation: Dispatch<SetStateAction<boolean>>;
};

export function ScenarioInputs({
  draftInflStdDev,
  editingInflation,
  inputs,
  numTrials,
  onInflationRiskChange,
  setDraftInflStdDev,
  setEditingInflation,
}: ScenarioInputsProps) {
  return (
    <div>
      <div className="text-label text-muted mb-1 font-medium">
        Scenario Inputs
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
        <AssumptionRow
          label="Withdrawals Start"
          value={String(
            new Date().getFullYear() + inputs.retirementAge - inputs.currentAge,
          )}
        />
        <AssumptionRow
          label="Projection Through"
          value={String(
            new Date().getFullYear() + inputs.endAge - inputs.currentAge,
          )}
        />
        <AssumptionRow
          label="Trials"
          value={numTrials.toLocaleString()}
          tip="Number of simulated market futures. More trials = more stable results. 1,000+ recommended; 2,500+ for precise tail estimates."
        />
        <AssumptionRow
          label="Starting Balance"
          value={formatCurrency(inputs.startingBalance)}
          tip="Total portfolio value across all accounts at the start of the projection."
        />
        <AssumptionRow
          label="Income (Salary + Bonus)"
          value={formatCurrency(inputs.salary)}
        />
        <AssumptionRow
          label="Base-Year Contributions"
          value={formatCurrency(inputs.annualContributions)}
        />
        <AssumptionRow
          label="Annual Expenses"
          value={formatCurrency(inputs.annualExpenses)}
          highlight={inputs.accumulationExpenseOverride != null}
        />
        <AssumptionRow
          label="Deterministic Inflation"
          value={formatPercent(inputs.inflationRate, 1)}
          tip="Fixed annual inflation rate used in the deterministic projection. The Fed targets 2%; historical US average is ~3%."
        />
        <InflationRiskRow
          draftInflStdDev={draftInflStdDev}
          editingInflation={editingInflation}
          inputs={inputs}
          onInflationRiskChange={onInflationRiskChange}
          setDraftInflStdDev={setDraftInflStdDev}
          setEditingInflation={setEditingInflation}
        />
        <AssumptionRow
          label="Blended Return"
          value={formatPercent(inputs.blendedReturn, 1)}
          tip="Weighted average expected return across all asset classes based on this year's allocation on the simulation's glide path. Typical range: 5-10% (bonds-heavy to equity-heavy)."
        />
        <AssumptionRow
          label="Blended Volatility"
          value={formatPercent(inputs.blendedVol, 1)}
          tip="Weighted average standard deviation of returns. Higher = wider range of outcomes. Typical range: 8-16% (diversified to all-equity)."
        />
        {withdrawalRateRows(inputs)}
      </div>
    </div>
  );
}
