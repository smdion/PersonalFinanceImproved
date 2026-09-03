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
  hasSalaryActiveFields: boolean;
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
  if (inputs.hasSalaryActiveFields)
    activeOverrides.push("Salary customizations active");

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
              ({activeOverrides.length} override
              {activeOverrides.length > 1 ? "s" : ""} active)
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
          {/* Preset badge + description */}
          <div
            className={`text-label rounded border px-2.5 py-2 leading-relaxed ${presetColors[inputs.preset]}`}
          >
            <span className="text-caption font-bold tracking-wider uppercase">
              {inputs.presetLabel}
            </span>
            <span className="mx-1.5">&mdash;</span>
            {inputs.presetDescription}
          </div>
          {/* Tax mode badge */}
          <div
            className={`text-label rounded border px-2.5 py-2 leading-relaxed ${
              inputs.taxMode === "simple"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-orange-200 bg-orange-50 text-orange-700"
            }`}
          >
            <span className="text-caption font-bold tracking-wider uppercase">
              {inputs.taxMode === "simple" ? "Simple" : "Advanced"}
            </span>
            <span className="mx-1.5">&mdash;</span>
            {inputs.taxMode === "simple"
              ? "Single balance, no tax (cFIREsim-comparable)"
              : "Tax-aware multi-account simulation with gross-up"}
          </div>

          {/* ELI5 explanation */}
          <div className="text-label text-muted bg-surface-primary border-subtle rounded border px-2.5 py-2 leading-relaxed">
            This runs{" "}
            <span className="text-secondary font-semibold">
              {numTrials.toLocaleString()}
            </span>{" "}
            simulated futures. Each trial randomizes annual investment returns
            (correlated log-normal draws per asset class) and inflation (
            {formatPercent(inputs.inflationRisk.meanRate, 1)} mean &plusmn;{" "}
            {formatPercent(inputs.inflationRisk.stdDev, 1)} std dev). Your
            portfolio follows a glide path that shifts from stocks to bonds as
            you age. At your current allocation, the blended expected return is{" "}
            <span className="text-secondary font-semibold">
              {formatPercent(inputs.blendedReturn, 1)}
            </span>{" "}
            with{" "}
            <span className="text-secondary font-semibold">
              {formatPercent(inputs.blendedVol, 1)}
            </span>{" "}
            volatility. The fan chart shows the{" "}
            {fanBandRange === "p5-p95"
              ? "90%"
              : fanBandRange === "p10-p90"
                ? "80%"
                : "50%"}{" "}
            confidence range across all trials.
          </div>

          {/* Active overrides callout */}
          {activeOverrides.length > 0 && (
            <div className="text-label rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-700">
              <span className="font-semibold">Active customizations:</span>
              <ul className="mt-0.5 ml-3 list-disc space-y-0">
                {activeOverrides.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Key scenario inputs — 2 columns on mobile, 4 on desktop */}
          <div>
            <div className="text-label text-muted mb-1 font-medium">
              Scenario Inputs
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
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
                highlight={inputs.hasSalaryActiveFields}
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
              {editingInflation ? (
                <div className="col-span-1 flex items-center gap-1">
                  <span className="text-caption text-muted whitespace-nowrap">
                    Stoch. Inflation
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={draftInflMean}
                    onChange={(e) => setDraftInflMean(e.target.value)}
                    className="text-caption w-12 rounded border px-0.5 py-0.5 text-center focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint text-caption">±</span>
                  <input
                    type="number"
                    step="0.1"
                    value={draftInflStdDev}
                    onChange={(e) => setDraftInflStdDev(e.target.value)}
                    className="text-caption w-12 rounded border px-0.5 py-0.5 text-center focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint text-caption">%</span>
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
                    className="text-micro ml-0.5 text-blue-600 underline"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingInflation(false)}
                    className="text-micro text-faint underline"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <AssumptionRow
                    label="Stochastic Inflation"
                    value={`${formatPercent(inputs.inflationRisk.meanRate, 1)} \u00B1 ${formatPercent(inputs.inflationRisk.stdDev, 1)}`}
                    tip="Simulation inflation: each simulated year draws a random rate from a normal distribution with this mean and standard deviation. Models inflation uncertainty — some futures have low inflation, others high. Typical mean: 2-3%."
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
                      className="text-micro text-blue-500 underline hover:text-blue-700"
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
                // None of the 8 strategies actually
                // read this rate to compute spending (Finding 0) — the old
                // copy here claimed Fixed uses it directly (`isDynamic`
                // false branch) and every dynamic strategy "adjusts this
                // yearly," which is also wrong for the 4 balance-derived
                // strategies (they never read this field at all, seeded or
                // otherwise) and imprecise for Guyton-Klinger (its guardrail
                // rate is self-derived, not seeded from this field either).
                //
                // Branch on `usesWithdrawalRate` (not `incomeSource`) for the
                // budget-vs-balance split — `incomeSource` classifies
                // Guyton-Klinger as "rate" (a UI-framing label, its own
                // config docs a portfolio-linked rate as the primary
                // control), but GK's actual spending IS budget-seeded and
                // guardrail-adjusted every year, same as Fixed/Forgo/
                // Spending-Decline (verified against guyton-klinger.ts and
                // decumulation-methodology-content.tsx's grouping).
                // `usesWithdrawalRate` correctly groups GK with the other 3
                // budget-continuation strategies; only RMD/Constant %/
                // Endowment/Vanguard Dynamic are truly balance-derived.
                const isBudgetSeeded = cfg?.usesWithdrawalRate === true;
                const rateTip =
                  cfg?.incomeSource === "formula"
                    ? `Reference rate only — ${cfg.label} computes withdrawals from the IRS RMD factor, not this rate.`
                    : !isBudgetSeeded && cfg
                      ? `Reference rate only — ${cfg.label} computes withdrawals as a percentage of your portfolio balance directly (see Strategy Params for its actual rate), not this field.`
                      : `Reference rate only — used to estimate the "years to FI" figure elsewhere. Your actual spending is driven by the Retirement Budget${strategy === "guyton_klinger" ? ", adjusted by guardrails" : strategy === "spending_decline" ? " and its own annual decline schedule" : ""}, not this rate.`;
                return (
                  <>
                    <AssumptionRow
                      label={
                        isDynamic
                          ? "Initial Withdrawal Rate"
                          : "Withdrawal Rate"
                      }
                      value={formatPercent(inputs.withdrawalRate, 1)}
                      tip={rateTip}
                    />
                    {isDynamic && (
                      <AssumptionRow
                        label="Spending Strategy"
                        value={cfg?.label ?? strategy}
                        tip={`${cfg?.label ?? strategy}: withdrawal amount adjusts each year based on portfolio performance, guardrails, or IRS factors. See Strategy Params for this strategy's own parameters — not the rate above.`}
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
                            ? isBudgetSeeded && cfg
                              ? `Starting retirement budget — your ${cfg.label} strategy adjusts actual spending from this figure each year.`
                              : `Starting retirement budget — ${cfg?.label ?? strategy} doesn't read this figure once it takes over (spending is computed from your portfolio balance instead); only used before that strategy fully applies, if at all.`
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
            <div className="mb-1 flex items-center justify-between">
              <div className="text-label text-muted font-medium">
                Asset Classes (Return / Volatility)
                {hasOverrides && (
                  <span className="ml-1 text-amber-600">
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
            {!editing ? (
              <table className="text-label w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted py-1 pr-2 text-left font-medium">
                      Asset Class
                    </th>
                    <th className="text-muted px-1.5 py-1 text-right font-medium">
                      Return
                    </th>
                    <th className="text-muted px-1.5 py-1 text-right font-medium">
                      Vol
                    </th>
                    <th className="text-muted px-1.5 py-1 text-right font-medium">
                      DB Return
                    </th>
                    <th className="text-muted px-1.5 py-1 text-right font-medium">
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
                      <tr key={ac.id} className="border-subtle border-b">
                        <td
                          className={`py-0.5 pr-2 ${isOverridden ? "font-medium text-amber-700" : "text-muted"}`}
                        >
                          {ac.name}
                        </td>
                        <td
                          className={`px-1.5 py-0.5 text-right font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                        >
                          {formatPercent(ac.meanReturn, 1)}
                        </td>
                        <td
                          className={`px-1.5 py-0.5 text-right font-medium tabular-nums ${isOverridden ? "text-amber-800" : "text-primary"}`}
                        >
                          {formatPercent(ac.stdDev, 1)}
                        </td>
                        <td
                          className={`px-1.5 py-0.5 text-right tabular-nums ${dbDiff ? "text-faint line-through" : "text-faint"}`}
                        >
                          {dbAc ? formatPercent(dbAc.meanReturn, 1) : "—"}
                        </td>
                        <td className="text-muted px-1.5 py-0.5 text-right tabular-nums">
                          {allocPct > 0 ? formatPercent(allocPct / 100) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="space-y-1">
                <div className="text-caption text-faint grid grid-cols-[1fr_80px_80px] gap-1 px-0.5 font-medium">
                  <span>Asset Class</span>
                  <span className="text-center">Return %</span>
                  <span className="text-center">Vol %</span>
                </div>
                {inputs.assetClasses.map((ac) => (
                  <div
                    key={ac.id}
                    className="grid grid-cols-[1fr_80px_80px] items-center gap-1"
                  >
                    <span className="text-muted truncate text-xs">
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
                      className="w-full rounded border px-1 py-0.5 text-center text-xs focus:border-blue-400 focus:outline-none"
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
                      className="w-full rounded border px-1 py-0.5 text-center text-xs focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            )}
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
              <div className="overflow-x-auto">
                <table className="text-label w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-muted py-1 pr-2 text-left font-medium">
                        Age
                      </th>
                      {inputs.assetClasses.map((ac) => (
                        <th
                          key={ac.id}
                          className="text-muted px-1.5 py-1 text-right font-medium"
                        >
                          {ac.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editingGlidePath
                      ? draftGlidePath.map((gp, gi) => (
                          <tr key={gp.age} className="border-subtle border-b">
                            <td className="text-muted py-0.5 pr-2 font-medium">
                              {gp.age}
                            </td>
                            {inputs.assetClasses.map((ac) => (
                              <td key={ac.id} className="px-0.5 py-0.5">
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
                                  className="text-caption w-full rounded border px-0.5 py-0.5 text-center tabular-nums focus:border-blue-400 focus:outline-none"
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
                              className={`border-subtle border-b ${isCurrentAge ? "bg-blue-50/50" : ""}`}
                            >
                              <td className="text-muted py-0.5 pr-2 font-medium">
                                {gp.age}
                                {isCurrentAge && (
                                  <span className="text-micro ml-1 text-blue-500">
                                    now
                                  </span>
                                )}
                              </td>
                              {inputs.assetClasses.map((ac) => {
                                const pct = (gp.allocations[ac.id] ?? 0) * 100;
                                return (
                                  <td
                                    key={ac.id}
                                    className="text-secondary px-1.5 py-0.5 text-right tabular-nums"
                                  >
                                    {pct > 0 ? formatPercent(pct / 100) : "—"}
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
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-label text-muted font-medium">
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
                    className="text-caption text-blue-600 underline hover:text-blue-800"
                  >
                    Edit
                  </button>
                )}
              {editingClamps && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingClamps(false)}
                    className="text-caption text-muted hover:text-secondary underline"
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
                    className="text-caption font-medium text-blue-600 underline hover:text-blue-800"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
            {editingClamps ? (
              <div className="text-label grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-center gap-1">
                  <span className="text-muted">Min (floor)</span>
                  <input
                    type="number"
                    step="1"
                    value={draftClampMin}
                    onChange={(e) => setDraftClampMin(e.target.value)}
                    className="text-caption w-16 rounded border px-1 py-0.5 text-center focus:border-blue-400 focus:outline-none"
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
                    className="text-caption w-16 rounded border px-1 py-0.5 text-center focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-faint">%</span>
                </div>
              </div>
            ) : (
              <div className="text-label grid grid-cols-2 gap-x-4 gap-y-0.5">
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
              <div className="text-label text-muted mb-1 font-medium">
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
                    <table className="text-caption border-collapse">
                      <thead>
                        <tr>
                          <th className="text-faint py-0.5 pr-1.5 text-left font-medium" />
                          {names.map((n) => (
                            <th
                              key={n}
                              className="text-faint px-1 py-0.5 text-right font-medium whitespace-nowrap"
                            >
                              {n.length > 8 ? n.slice(0, 7) + "…" : n}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {names.map((row) => (
                          <tr key={row} className="border-subtle border-t">
                            <td className="text-muted py-0.5 pr-1.5 font-medium whitespace-nowrap">
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
                                  className={`px-1 py-0.5 text-right tabular-nums ${bg}`}
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
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-surface-sunken text-secondary px-4 py-3 text-sm font-medium">
            Outcome Distribution
          </div>
          <div className="text-muted space-y-2 px-4 py-4 text-sm">
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
              tip="25th–75th percentile range of annual withdrawals across all simulation trials, in today's purchasing power. Unlike the deterministic estimate, this accounts for market volatility, sequence-of-returns risk, and tax gross-up."
            />
            <div className="border-subtle mt-2 border-t pt-2">
              <div className="text-label text-muted mb-1.5 font-medium">
                Terminal Balance Percentiles
              </div>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
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
                    <div className="text-caption text-faint">{desc}</div>
                    <div
                      className={`font-medium ${val <= 0 ? "text-red-600" : "text-secondary"}`}
                    >
                      {deflate
                        ? formatCurrency(deflate(val))
                        : formatCurrency(val)}
                    </div>
                    <div className="text-micro text-faint">{label}</div>
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
