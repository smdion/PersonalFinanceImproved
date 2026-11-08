"use client";

import { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type {
  SimulationInputs,
  AssetClassOverride,
  OutcomeDistribution,
} from "./mc-simulation-types";
import { AssumptionRow } from "./assumption-row";
import { InflationRiskRow, withdrawalRateRows } from "./mc-scenario-inputs";
import { AssetClassTable } from "./mc-asset-classes";
import { GlidePathTable } from "./mc-glide-path";
import { correlationMatrix, ReturnClampSection } from "./mc-bounds";
import { OutcomeDistributionPanel } from "./mc-outcome-distribution";
import { AssumptionsOverview } from "./mc-assumptions-overview";

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
          <div>
            <div className="text-label text-muted mb-1 font-medium">
              Scenario Inputs
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
              <AssumptionRow
                label="Withdrawals Start"
                value={String(
                  new Date().getFullYear() +
                    inputs.retirementAge -
                    inputs.currentAge,
                )}
              />
              <AssumptionRow
                label="Plan Through"
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

          {/* Asset classes */}
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

          {/* Glide path table */}
          {inputs.glidePath.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-label text-muted font-medium">
                  Glide Path (allocation shifts with age)
                </div>
                {onGlidePathChange && !editingGlidePath && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftGlidePath(
                        inputs.glidePath.map((gp) => ({
                          age: gp.age,
                          allocations: Object.fromEntries(
                            inputs.assetClasses.map((ac) => [
                              ac.id,
                              ((gp.allocations[ac.id] ?? 0) * 100).toFixed(0),
                            ]),
                          ),
                        })),
                      );
                      setEditingGlidePath(true);
                    }}
                    className="text-caption text-blue-600 underline hover:text-blue-800"
                  >
                    Edit
                  </button>
                )}
                {editingGlidePath && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingGlidePath(false)}
                      className="text-caption text-muted hover:text-secondary underline"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onGlidePathChange) {
                          onGlidePathChange(
                            draftGlidePath.map((gp) => ({
                              age: gp.age,
                              allocations: Object.fromEntries(
                                Object.entries(gp.allocations).map(([k, v]) => [
                                  k,
                                  (parseFloat(v) || 0) / 100,
                                ]),
                              ),
                            })),
                          );
                        }
                        setEditingGlidePath(false);
                      }}
                      className="text-caption font-medium text-blue-600 underline hover:text-blue-800"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
              <GlidePathTable
                draftGlidePath={draftGlidePath}
                editingGlidePath={editingGlidePath}
                inputs={inputs}
                setDraftGlidePath={setDraftGlidePath}
              />
            </div>
          )}

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
          {inputs.correlations.length > 0 && (
            <div>
              <div className="text-label text-muted mb-1 font-medium">
                Asset Class Correlations
                <HelpTip text="Pairwise correlations used to generate correlated random returns across asset classes each simulation year. Values range from -1 (perfectly inverse) to +1 (perfectly correlated)." />
              </div>
              {correlationMatrix(inputs)}
            </div>
          )}
        </div>
      )}

      {/* Outcome Distribution — detail metrics moved here from inline KPIs */}
      <OutcomeDistributionPanel outcomeDistribution={outcomeDistribution} />
    </div>
  );
}
