/**
 * Tests for SimulationAssumptions' withdrawal-rate tooltip branching.
 * Focused on the exact bug class: text must be keyed off
 * `usesWithdrawalRate` (the real
 * budget-seeded-vs-balance-derived split), not `incomeSource` (a UI-framing
 * label that misclassifies Guyton-Klinger as balance-derived even though
 * its spending is budget-seeded and guardrail-adjusted every year).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SimulationAssumptions,
  type SimulationInputs,
} from "@/components/cards/mc-simulation-assumptions";

// HelpTip needs a Radix TooltipProvider ancestor this component doesn't
// supply on its own — stub it to render `text` as a queryable title, same
// pattern as overrides-panel-v2.test.tsx / projection-splits.test.tsx.
vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

function baseInputs(
  overrides: Partial<SimulationInputs> = {},
): SimulationInputs {
  return {
    currentAge: 45,
    retirementAge: 65,
    endAge: 95,
    startingBalance: 500000,
    annualContributions: 20000,
    annualExpenses: 60000,
    inflationRate: 0.025,
    salary: 150000,
    assetClasses: [{ id: 1, name: "US Stock", meanReturn: 0.08, stdDev: 0.15 }],
    dbAssetClasses: [
      { id: 1, name: "US Stock", meanReturn: 0.08, stdDev: 0.15 },
    ],
    currentAllocation: { 1: 1 },
    glidePathAges: [45],
    glidePath: [{ age: 45, allocations: { 1: 1 } }],
    preset: "default",
    presetLabel: "Default",
    presetDescription: "Baseline assumptions",
    blendedReturn: 0.08,
    blendedVol: 0.15,
    inflationRisk: { meanRate: 0.03, stdDev: 0.01 },
    withdrawalRate: 0.04,
    taxMode: "simple",
    hasAssetClassOverrides: false,
    hasSalaryActiveFields: false,
    correlations: [],
    returnClampMin: -1,
    returnClampMax: 1,
    returnMultiplier: 1,
    volMultiplier: 1,
    ...overrides,
  };
}

describe("SimulationAssumptions — withdrawal rate tooltip", () => {
  it("labels Guyton-Klinger as budget-seeded, not balance-derived", () => {
    render(
      <SimulationAssumptions
        inputs={baseInputs({ withdrawalStrategy: "guyton_klinger" })}
        numTrials={200}
      />,
    );
    const trigger = screen.getByTitle(
      /Retirement Budget, adjusted by guardrails/,
    );
    expect(trigger).toBeInTheDocument();
    // Must NOT get the balance-derived claim — GK has no "actual rate" in
    // Strategy Params, and it doesn't compute balance × rate.
    expect(
      screen.queryByTitle(
        /computes withdrawals as a percentage of your portfolio balance directly/,
      ),
    ).not.toBeInTheDocument();
  });

  it("labels Constant Percentage as balance-derived", () => {
    render(
      <SimulationAssumptions
        inputs={baseInputs({ withdrawalStrategy: "constant_percentage" })}
        numTrials={200}
      />,
    );
    expect(
      screen.getByTitle(
        /computes withdrawals as a percentage of your portfolio balance directly/,
      ),
    ).toBeInTheDocument();
  });

  it("labels RMD-Based Spending with the IRS-formula tip", () => {
    render(
      <SimulationAssumptions
        inputs={baseInputs({ withdrawalStrategy: "rmd_spending" })}
        numTrials={200}
      />,
    );
    expect(
      screen.getByTitle(/computes withdrawals from the IRS RMD factor/),
    ).toBeInTheDocument();
  });

  it("Fixed strategy shows the budget-driven reference-rate tip", () => {
    render(<SimulationAssumptions inputs={baseInputs()} numTrials={200} />);
    expect(
      screen.getByTitle(
        /Your actual spending is driven by the Retirement Budget/,
      ),
    ).toBeInTheDocument();
  });
});
