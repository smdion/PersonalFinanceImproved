"use client";

import { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SimulationInputs = {
  currentAge: number;
  retirementAge: number;
  endAge: number;
  startingBalance: number;
  annualContributions: number;
  annualExpenses: number;
  inflationRate: number;
  salary: number;
  assetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];
  dbAssetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];
  currentAllocation: Record<number, number>;
  glidePathAges: number[];
  glidePath: { age: number; allocations: Record<number, number> }[];
  preset: "aggressive" | "default" | "conservative" | "custom";
  presetLabel: string;
  presetDescription: string;
  blendedReturn: number;
  blendedVol: number;
  inflationRisk: { meanRate: number; stdDev: number };
  withdrawalRate: number;
  withdrawalStrategy?: string;
  decumulationExpenseOverride?: number;
  accumulationExpenseOverride?: number;
  taxMode: "simple" | "advanced";
  hasAssetClassOverrides: boolean;
  hasSalaryOverrides: boolean;
  correlations: { classAId: number; classBId: number; correlation: number }[];
  returnClampMin: number;
  returnClampMax: number;
  returnMultiplier: number;
  volMultiplier: number;
};

export type AssetClassOverride = {
  id: number;
  meanReturn?: number;
  stdDev?: number;
};

// ---------------------------------------------------------------------------
// SimulationAssumptions
// ---------------------------------------------------------------------------

export type OutcomeDistribution = {
  successRate: number;
  medianEndBalance: number;
  p5EndBalance: number;
  terminalBalance: {
    p10: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
  };
  sustainableWithdrawalPV: { p25: number; p75: number };
  depletionAge?: { median: number };
  computeTimeMs: number;
};

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
  deflate,
}: {
  inputs: SimulationInputs;
  numTrials: number;
  onAssetClassOverridesChange?: (overrides: AssetClassOverride[]) => void;
  assetClassOverrides?: AssetClassOverride[];
  fanBandRange?: "off" | "p25-p75" | "p10-p90" | "p5-p95";
  onGlidePathChange?: (
    entries: { age: number; allocations: Record<number, number> }[],
  ) => void;
  onInflationRiskChange?: (meanRate: number, stdDev: number) => void;
  onClampBoundsChange?: (min: number, max: number) => void;
  outcomeDistribution?: OutcomeDistribution;
  deflate?: (amount: number) => number;
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
  const [draftInflMean, setDraftInflMean] = useState("");
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
      `Pre-retirement expense override: ${formatCurrency(inputs.accumulationExpenseOverride)}/yr`,
    );
  if (inputs.decumulationExpenseOverride != null)
    activeOverrides.push(
      `Retirement expense override: ${formatCurrency(inputs.decumulationExpenseOverride)}/yr`,
    );
  if (inputs.hasSalaryOverrides)
    activeOverrides.push("Salary overrides active");

  const presetColors: Record<string, string> = {
    aggressive: "text-red-600 bg-red-50 border-red-200",
    default: "text-blue-600 bg-blue-50 border-blue-200",
    conservative: "text-green-700 bg-green-50 border-green-200",
    custom: "text-purple-600 bg-purple-50 border-purple-200",
  };

  return (
    <div className="bg-surface-sunken border rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted hover:bg-surface-elevated rounded-lg transition-colors"
      >
        <span className="font-medium">
          Simulation Assumptions
          {activeOverrides.length > 0 && (
            <span className="text-amber-600 ml-1">
              ({activeOverrides.length} override
              {activeOverrides.length > 1 ? "s" : ""} active)
            </span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
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
        <div className="px-3 pb-3 space-y-3">
          {/* Preset badge + description */}
          <div
            className={`text-[11px] leading-relaxed rounded px-2.5 py-2 border ${presetColors[inputs.preset]}`}
          >
            <span className="font-bold uppercase tracking-wider text-[10px]">
              {inputs.presetLabel}
            </span>
            <span className="mx-1.5">&mdash;</span>
            {inputs.presetDescription}
          </div>
          {/* Tax mode badge */}
          <div
            className={`text-[11px] leading-relaxed rounded px-2.5 py-2 border ${
              inputs.taxMode === "simple"
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-orange-50 border-orange-200 text-orange-700"
            }`}
          >
            <span className="font-bold uppercase tracking-wider text-[10px]">
              {inputs.taxMode === "simple" ? "Simple" : "Advanced"}
            </span>
            <span className="mx-1.5">&mdash;</span>
            {inputs.taxMode === "simple"
              ? "Single balance, no tax (cFIREsim-comparable)"
              : "Tax-aware multi-account simulation with gross-up"}
          </div>

          {/* ELI5 explanation */}
          <div className="text-[11px] text-muted leading-relaxed bg-surface-primary rounded px-2.5 py-2 border border-subtle">
            This runs{" "}
            <span className="font-semibold text-secondary">
              {numTrials.toLocaleString()}
            </span>{" "}
            simulated futures. Each trial randomizes annual investment returns
            (correlated log-normal draws per asset class) and inflation (
            {formatPercent(inputs.inflationRisk.meanRate, 1)} mean &plusmn;{" "}
            {formatPercent(inputs.inflationRisk.stdDev, 1)} std dev). Your
            portfolio follows a glide path that shifts from stocks to bonds as
            you age. At your current allocation, the blended expected return is{" "}
            <span className="font-semibold text-secondary">
              {formatPercent(inputs.blendedReturn, 1)}
            </span>{" "}
            with{" "}
            <span className="font-semibold text-secondary">
              {formatPercent(inputs.blendedVol, 1)}
            </span>{" "}
            volatility. The fan chart shows the{" "}
            {fanBandRange === "p5-p95"
              ? "5th–95th"
              : fanBandRange === "p10-p90"
                ? "10th–90th"
                : "25th–75th"}{" "}
            percentile range across all trials.
          </div>

          {/* Active overrides callout */}
          {activeOverrides.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-2.5 py-2 border border-amber-200">
              <span className="font-semibold">Active overrides:</span>
              <ul className="mt-0.5 ml-3 list-disc space-y-0">
                {activeOverrides.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Key scenario inputs — 2 columns on mobile, 4 on desktop */}
          <div>
            <div className="text-[11px] font-medium text-muted mb-1">
              Scenario Inputs
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
              <AssumptionRow
                label="Current Age"
                value={String(inputs.currentAge)}
              />
              <AssumptionRow
                label="Retirement Age"
                value={String(inputs.retirementAge)}
              />
              <AssumptionRow label="End Age" value={String(inputs.endAge)} />
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
                highlight={inputs.hasSalaryOverrides}
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
                value={`${(inputs.inflationRate * 100).toFixed(1)}%`}
                tip="Fixed annual inflation rate used in the deterministic projection. The Fed targets 2%; historical US average is ~3%."
              />
              {editingInflation ? (
                <div className="flex items-center gap-1 col-span-1">
                  <span className="text-[10px] text-muted whitespace-nowrap">
                    Stoch. Inflation
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={draftInflMean}
                    onChange={(e) => setDraftInflMean(e.target.value)}
                    className="w-12 text-[10px] text-center border rounded px-0.5 py-0.5 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint text-[10px]">±</span>
                  <input
                    type="number"
                    step="0.1"
                    value={draftInflStdDev}
                    onChange={(e) => setDraftInflStdDev(e.target.value)}
                    className="w-12 text-[10px] text-center border rounded px-0.5 py-0.5 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint text-[10px]">%</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onInflationRiskChange) {
                        onInflationRiskChange(
                          parseFloat(draftInflMean) / 100,
                          parseFloat(draftInflStdDev) / 100,
                        );
                      }
                      setEditingInflation(false);
                    }}
                    className="text-[9px] text-blue-600 underline ml-0.5"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingInflation(false)}
                    className="text-[9px] text-faint underline"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <AssumptionRow
                    label="Stochastic Inflation"
                    value={`${(inputs.inflationRisk.meanRate * 100).toFixed(1)}% \u00B1 ${(inputs.inflationRisk.stdDev * 100).toFixed(1)}%`}
                    tip="Monte Carlo inflation: each simulated year draws a random rate from a normal distribution with this mean and standard deviation. Models inflation uncertainty — some futures have low inflation, others high. Typical mean: 2-3%."
                  />
                  {onInflationRiskChange && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftInflMean(
                          (inputs.inflationRisk.meanRate * 100).toFixed(1),
                        );
                        setDraftInflStdDev(
                          (inputs.inflationRisk.stdDev * 100).toFixed(1),
                        );
                        setEditingInflation(true);
                      }}
                      className="text-[9px] text-blue-500 hover:text-blue-700 underline"
                    >
                      edit
                    </button>
                  )}
                </div>
              )}
              <AssumptionRow
                label="Blended Return"
                value={formatPercent(inputs.blendedReturn, 1)}
                tip="Weighted average expected return across all asset classes based on your current glide path allocation. Typical range: 5-10% (bonds-heavy to equity-heavy)."
              />
              <AssumptionRow
                label="Blended Volatility"
                value={formatPercent(inputs.blendedVol, 1)}
                tip="Weighted average standard deviation of returns. Higher = wider range of outcomes. Typical range: 8-16% (diversified to all-equity)."
              />
              {(() => {
                const strategy = (inputs.withdrawalStrategy ??
                  "fixed") as WithdrawalStrategyType;
                const cfg = WITHDRAWAL_STRATEGY_CONFIG[strategy];
                const isDynamic = strategy !== "fixed";
                return (
                  <>
                    <AssumptionRow
                      label={
                        isDynamic
                          ? "Initial Withdrawal Rate"
                          : "Withdrawal Rate"
                      }
                      value={formatPercent(inputs.withdrawalRate, 1)}
                      tip={
                        isDynamic
                          ? `Starting withdrawal rate — your ${cfg?.label ?? strategy} strategy adjusts this yearly based on portfolio performance. The actual withdrawal each year may be higher or lower.`
                          : "Percentage of your portfolio withdrawn annually in retirement to cover expenses. The '4% rule' (Bengen, 1994) is the classic safe withdrawal benchmark. Lower = safer but less spending. Typical range: 3-4%."
                      }
                    />
                    {isDynamic && (
                      <AssumptionRow
                        label="Spending Strategy"
                        value={cfg?.label ?? strategy}
                        tip={`${cfg?.label ?? strategy}: withdrawal amount adjusts each year based on portfolio performance, guardrails, or IRS factors. The rate above is the starting point, not a fixed annual amount.`}
                        highlight
                      />
                    )}
                    {inputs.decumulationExpenseOverride != null && (
                      <AssumptionRow
                        label={
                          isDynamic
                            ? "Year-1 Retirement Expenses"
                            : "Retirement Expenses"
                        }
                        value={`${formatCurrency(inputs.decumulationExpenseOverride)}/yr`}
                        tip={
                          isDynamic
                            ? `Starting retirement budget — your ${cfg?.label ?? strategy} strategy may adjust actual spending up or down each year.`
                            : undefined
                        }
                        highlight
                      />
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Asset classes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-medium text-muted">
                Asset Classes (Return / Volatility)
                {hasOverrides && (
                  <span className="text-amber-600 ml-1">
                    (custom overrides)
                  </span>
                )}
              </div>
              {onAssetClassOverridesChange && !editing && (
                <div className="flex gap-1.5">
                  {hasOverrides && (
                    <button
                      type="button"
                      onClick={resetOverrides}
                      className="text-[10px] text-amber-600 hover:text-amber-800 underline"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={startEditing}
                    className="text-[10px] text-blue-600 hover:text-blue-800 underline"
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
                    className="text-[10px] text-muted hover:text-secondary underline"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyEdits}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
            {!editing ? (
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left text-muted font-medium py-1 pr-2">
                      Asset Class
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      Return
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      Vol
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      DB Return
                    </th>
                    <th className="text-right text-muted font-medium py-1 px-1.5">
                      Alloc
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.assetClasses.map((ac) => {
                    const override = assetClassOverrides?.find(
                      (o) => o.id === ac.id,
                    );
                    const isOverridden =
                      override &&
                      (override.meanReturn !== undefined ||
                        override.stdDev !== undefined);
                    const dbAc = inputs.dbAssetClasses.find(
                      (d) => d.id === ac.id,
                    );
                    const dbDiff =
                      dbAc && Math.abs(dbAc.meanReturn - ac.meanReturn) > 0.001;
                    const allocPct =
                      (inputs.currentAllocation[ac.id] ?? 0) * 100;
                    return (
                      <tr key={ac.id} className="border-b border-subtle">
                        <td
                          className={`py-0.5 pr-2 ${isOverridden ? "text-amber-700 font-medium" : "text-muted"}`}
                        >
                          {ac.name}
                        </td>
                        <td
                          className={`text-right py-0.5 px-1.5 font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                        >
                          {(ac.meanReturn * 100).toFixed(1)}%
                        </td>
                        <td
                          className={`text-right py-0.5 px-1.5 font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                        >
                          {(ac.stdDev * 100).toFixed(1)}%
                        </td>
                        <td
                          className={`text-right py-0.5 px-1.5 tabular-nums ${dbDiff ? "text-faint line-through" : "text-faint"}`}
                        >
                          {dbAc
                            ? `${(dbAc.meanReturn * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="text-right py-0.5 px-1.5 text-muted tabular-nums">
                          {allocPct > 0 ? `${allocPct.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_80px_80px] gap-1 text-[10px] text-faint font-medium px-0.5">
                  <span>Asset Class</span>
                  <span className="text-center">Return %</span>
                  <span className="text-center">Vol %</span>
                </div>
                {inputs.assetClasses.map((ac) => (
                  <div
                    key={ac.id}
                    className="grid grid-cols-[1fr_80px_80px] gap-1 items-center"
                  >
                    <span className="text-xs text-muted truncate">
                      {ac.name}
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={draftReturns[ac.id] ?? ""}
                      onChange={(e) =>
                        setDraftReturns((prev) => ({
                          ...prev,
                          [ac.id]: e.target.value,
                        }))
                      }
                      className="w-full text-xs text-center border rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none"
                    />
                    <input
                      type="number"
                      step="0.1"
                      value={draftVols[ac.id] ?? ""}
                      onChange={(e) =>
                        setDraftVols((prev) => ({
                          ...prev,
                          [ac.id]: e.target.value,
                        }))
                      }
                      className="w-full text-xs text-center border rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Glide path table */}
          {inputs.glidePath.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-medium text-muted">
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
                    className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                  >
                    Edit
                  </button>
                )}
                {editingGlidePath && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingGlidePath(false)}
                      className="text-[10px] text-muted hover:text-secondary underline"
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
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left text-muted font-medium py-1 pr-2">
                        Age
                      </th>
                      {inputs.assetClasses.map((ac) => (
                        <th
                          key={ac.id}
                          className="text-right text-muted font-medium py-1 px-1.5"
                        >
                          {ac.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editingGlidePath
                      ? draftGlidePath.map((gp, gi) => (
                          <tr key={gp.age} className="border-b border-subtle">
                            <td className="py-0.5 pr-2 text-muted font-medium">
                              {gp.age}
                            </td>
                            {inputs.assetClasses.map((ac) => (
                              <td key={ac.id} className="py-0.5 px-0.5">
                                <input
                                  type="number"
                                  step="1"
                                  value={gp.allocations[ac.id] ?? "0"}
                                  onChange={(e) => {
                                    setDraftGlidePath((prev) =>
                                      prev.map((item, idx) =>
                                        idx === gi
                                          ? {
                                              age: item.age,
                                              allocations: {
                                                ...item.allocations,
                                                [ac.id]: e.target.value,
                                              },
                                            }
                                          : item,
                                      ),
                                    );
                                  }}
                                  className="w-full text-[10px] text-center border rounded px-0.5 py-0.5 focus:border-blue-400 focus:outline-none tabular-nums"
                                />
                              </td>
                            ))}
                          </tr>
                        ))
                      : inputs.glidePath.map((gp) => {
                          const isCurrentAge =
                            gp.age <=
                              inputs.currentAge +
                                (inputs.glidePath.find(
                                  (g) => g.age > inputs.currentAge,
                                )?.age ?? gp.age) &&
                            gp.age >= inputs.currentAge;
                          return (
                            <tr
                              key={gp.age}
                              className={`border-b border-subtle ${isCurrentAge ? "bg-blue-50/50" : ""}`}
                            >
                              <td className="py-0.5 pr-2 text-muted font-medium">
                                {gp.age}
                                {isCurrentAge && (
                                  <span className="text-blue-500 text-[9px] ml-1">
                                    now
                                  </span>
                                )}
                              </td>
                              {inputs.assetClasses.map((ac) => {
                                const pct = (gp.allocations[ac.id] ?? 0) * 100;
                                return (
                                  <td
                                    key={ac.id}
                                    className="text-right py-0.5 px-1.5 text-secondary tabular-nums"
                                  >
                                    {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preset multipliers */}
          {inputs.preset !== "custom" && (
            <div>
              <div className="text-[11px] font-medium text-muted mb-1">
                Preset Multipliers
                <HelpTip text="How the selected preset modifies the raw DB asset class values. Return multiplier scales expected returns; vol multiplier scales volatility." />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-medium text-muted">
                Return Clamp Bounds
                <HelpTip text="Simulated annual returns are clamped to this range to prevent extreme outliers from dominating results." />
              </div>
              {onClampBoundsChange &&
                inputs.preset === "custom" &&
                !editingClamps && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftClampMin(
                        (inputs.returnClampMin * 100).toFixed(0),
                      );
                      setDraftClampMax(
                        (inputs.returnClampMax * 100).toFixed(0),
                      );
                      setEditingClamps(true);
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                  >
                    Edit
                  </button>
                )}
              {editingClamps && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingClamps(false)}
                    className="text-[10px] text-muted hover:text-secondary underline"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onClampBoundsChange) {
                        onClampBoundsChange(
                          parseFloat(draftClampMin) / 100,
                          parseFloat(draftClampMax) / 100,
                        );
                      }
                      setEditingClamps(false);
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
            {editingClamps ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="flex items-center gap-1">
                  <span className="text-muted">Min (floor)</span>
                  <input
                    type="number"
                    step="1"
                    value={draftClampMin}
                    onChange={(e) => setDraftClampMin(e.target.value)}
                    className="w-16 text-[10px] text-center border rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint">%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted">Max (ceiling)</span>
                  <input
                    type="number"
                    step="1"
                    value={draftClampMax}
                    onChange={(e) => setDraftClampMax(e.target.value)}
                    className="w-16 text-[10px] text-center border rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint">%</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                <AssumptionRow
                  label="Min (floor)"
                  value={formatPercent(inputs.returnClampMin, 0)}
                />
                <AssumptionRow
                  label="Max (ceiling)"
                  value={formatPercent(inputs.returnClampMax, 0)}
                />
              </div>
            )}
          </div>

          {/* Correlation matrix */}
          {inputs.correlations.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted mb-1">
                Asset Class Correlations
                <HelpTip text="Pairwise correlations used to generate correlated random returns across asset classes each simulation year. Values range from -1 (perfectly inverse) to +1 (perfectly correlated)." />
              </div>
              {(() => {
                const idToName = new Map(
                  inputs.assetClasses.map((ac) => [ac.id, ac.name]),
                );
                const names = Array.from(
                  new Set(
                    inputs.correlations.flatMap((c) => [
                      idToName.get(c.classAId) ?? String(c.classAId),
                      idToName.get(c.classBId) ?? String(c.classBId),
                    ]),
                  ),
                ).sort();
                const corrMap = new Map<string, number>();
                for (const c of inputs.correlations) {
                  const a = idToName.get(c.classAId) ?? String(c.classAId);
                  const b = idToName.get(c.classBId) ?? String(c.classBId);
                  corrMap.set(`${a}|${b}`, c.correlation);
                  corrMap.set(`${b}|${a}`, c.correlation);
                }
                return (
                  <div className="overflow-x-auto">
                    <table className="text-[10px] border-collapse">
                      <thead>
                        <tr>
                          <th className="py-0.5 pr-1.5 text-left text-faint font-medium" />
                          {names.map((n) => (
                            <th
                              key={n}
                              className="py-0.5 px-1 text-right text-faint font-medium whitespace-nowrap"
                            >
                              {n.length > 8 ? n.slice(0, 7) + "…" : n}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {names.map((row) => (
                          <tr key={row} className="border-t border-subtle">
                            <td className="py-0.5 pr-1.5 text-muted font-medium whitespace-nowrap">
                              {row.length > 8 ? row.slice(0, 7) + "…" : row}
                            </td>
                            {names.map((col) => {
                              const val =
                                row === col
                                  ? 1
                                  : (corrMap.get(`${row}|${col}`) ?? 0);
                              const bg =
                                row === col
                                  ? "bg-surface-elevated"
                                  : val > 0.5
                                    ? "bg-green-50 text-green-700"
                                    : val > 0
                                      ? "bg-green-50/50 text-green-600"
                                      : val < -0.3
                                        ? "bg-red-50 text-red-600"
                                        : val < 0
                                          ? "bg-red-50/50 text-red-500"
                                          : "text-faint";
                              return (
                                <td
                                  key={col}
                                  className={`py-0.5 px-1 text-right tabular-nums ${bg}`}
                                >
                                  {val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Outcome Distribution — detail metrics moved here from inline KPIs */}
      {outcomeDistribution && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-surface-sunken text-sm font-medium text-secondary">
            Outcome Distribution
          </div>
          <div className="px-4 py-4 space-y-2 text-sm text-muted">
            <AssumptionRow
              label="Median End Balance"
              value={
                deflate
                  ? formatCurrency(
                      deflate(outcomeDistribution.medianEndBalance),
                    )
                  : formatCurrency(outcomeDistribution.medianEndBalance)
              }
              tip="50th percentile terminal portfolio value. When some scenarios deplete, the median still reflects surviving paths — which benefit from compounding — so it can appear high even with meaningful depletion risk."
            />
            <AssumptionRow
              label="P5 End Balance (worst realistic)"
              value={
                deflate
                  ? formatCurrency(deflate(outcomeDistribution.p5EndBalance))
                  : formatCurrency(outcomeDistribution.p5EndBalance)
              }
              highlight={outcomeDistribution.p5EndBalance <= 0}
              tip="Only 5% of scenarios end worse than this. If this is $0, a meaningful number of simulations fully depleted."
            />
            <AssumptionRow
              label="Simulated Withdrawal Range (p25–p75)"
              value={`${formatCurrency(outcomeDistribution.sustainableWithdrawalPV.p25)} – ${formatCurrency(outcomeDistribution.sustainableWithdrawalPV.p75)}`}
              tip="25th–75th percentile range of annual withdrawals across all Monte Carlo trials, in today's purchasing power. Unlike the deterministic estimate, this accounts for market volatility, sequence-of-returns risk, and tax gross-up."
            />
            <div className="border-t border-subtle pt-2 mt-2">
              <div className="text-[11px] font-medium text-muted mb-1.5">
                Terminal Balance Percentiles
              </div>
              <div className="grid grid-cols-5 gap-2 text-xs text-center">
                {(
                  [
                    [
                      "p10",
                      outcomeDistribution.terminalBalance.p10,
                      "Bad luck",
                    ],
                    [
                      "p25",
                      outcomeDistribution.terminalBalance.p25,
                      "Below avg",
                    ],
                    [
                      "p50",
                      outcomeDistribution.terminalBalance.median,
                      "Typical",
                    ],
                    [
                      "p75",
                      outcomeDistribution.terminalBalance.p75,
                      "Above avg",
                    ],
                    [
                      "p90",
                      outcomeDistribution.terminalBalance.p90,
                      "Good luck",
                    ],
                  ] as const
                ).map(([label, val, desc]) => (
                  <div key={label}>
                    <div className="text-[10px] text-faint">{desc}</div>
                    <div
                      className={`font-medium ${val <= 0 ? "text-red-600" : "text-secondary"}`}
                    >
                      {deflate
                        ? formatCurrency(deflate(val))
                        : formatCurrency(val)}
                    </div>
                    <div className="text-[9px] text-faint">{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <AssumptionRow
              label="Compute Time"
              value={`${(outcomeDistribution.computeTimeMs / 1000).toFixed(1)}s`}
              tip="Wall-clock time for the simulation run."
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AssumptionRow({
  label,
  value,
  highlight,
  tip,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tip?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className={highlight ? "text-amber-600" : "text-muted"}>
        {label}
        {tip && <HelpTip text={tip} />}
      </span>
      <span
        className={`font-medium ${highlight ? "text-amber-800" : "text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}
