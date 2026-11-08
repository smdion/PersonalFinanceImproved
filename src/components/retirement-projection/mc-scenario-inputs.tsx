import type { SimulationInputs } from "./mc-simulation-types";
import { STRATEGY_CONFIG_BY_STORED_KEY } from "@/lib/config/stored-withdrawal-strategy";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { AssumptionRow } from "./assumption-row";
import type { Dispatch, SetStateAction } from "react";

export function withdrawalRateRows(inputs: SimulationInputs) {
  const strategy = inputs.withdrawalStrategy as WithdrawalStrategyType;
  const cfg = STRATEGY_CONFIG_BY_STORED_KEY[strategy];
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
  // methodology/decumulation-content.tsx's grouping).
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
        label={isDynamic ? "Initial Withdrawal Rate" : "Withdrawal Rate"}
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
            isDynamic ? "Year-1 Retirement Expenses" : "Retirement Expenses"
          }
          value={`${formatCurrency(inputs.decumulationExpenseOverride)}/yr`}
          tip={
            isDynamic
              ? isBudgetSeeded
                ? `Starting retirement budget — your ${cfg.label} strategy adjusts actual spending from this figure each year.`
                : `Starting retirement budget — ${cfg?.label ?? strategy} doesn't read this figure once it takes over (spending is computed from your portfolio balance instead); only used before that strategy fully applies, if at all.`
              : undefined
          }
          highlight
        />
      )}
    </>
  );
}

export type InflationRiskRowProps = {
  draftInflStdDev: string;
  editingInflation: boolean;
  inputs: SimulationInputs;
  onInflationRiskChange: ((stdDev: number) => void) | undefined;
  setDraftInflStdDev: Dispatch<SetStateAction<string>>;
  setEditingInflation: Dispatch<SetStateAction<boolean>>;
};

export function InflationRiskRow({
  draftInflStdDev,
  editingInflation,
  inputs,
  onInflationRiskChange,
  setDraftInflStdDev,
  setEditingInflation,
}: InflationRiskRowProps) {
  return (
    <>
      {editingInflation ? (
        <div className="col-span-1 flex items-center gap-1">
          <span className="text-caption text-muted whitespace-nowrap">
            Stoch. Inflation
          </span>
          <span className="text-caption text-muted tabular-nums">
            {formatPercent(inputs.inflationRate, 1)} ±
          </span>
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
                onInflationRiskChange(parseFloat(draftInflStdDev) / 100);
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
            value={`${formatPercent(inputs.inflationRate, 1)} \u00B1 ${formatPercent(inputs.inflationRisk.stdDev, 1)}`}
            tip={`Your inflation rate, varied in each trial by this standard deviation a year; your post-retirement raise (${formatPercent(inputs.postRetirementInflationRate, 1)}) moves with it. Set the rates themselves in your retirement settings — here you set only the spread. Each trial runs at its own average, and its today's dollars use its own inflation. Typical spread: about 1%.`}
          />
          {onInflationRiskChange && (
            <button
              type="button"
              onClick={() => {
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
    </>
  );
}
