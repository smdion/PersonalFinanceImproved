import type { SimulationInputs } from "./mc-simulation-types";
import { storedStrategyConfig } from "@/lib/config/stored-withdrawal-strategy";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { AssumptionRow } from "./assumption-row";
import type { Dispatch, SetStateAction } from "react";

export function withdrawalRateRows(inputs: SimulationInputs) {
  const strategy = inputs.withdrawalStrategy as WithdrawalStrategyType;
  const cfg = storedStrategyConfig(strategy);
  const isDynamic = strategy !== "fixed";
  // No strategy reads this rate to compute spending. `usesWithdrawalRate` (not
  // `incomeSource`) splits budget-seeded strategies (Fixed, Forgo, Spending-
  // Decline, Guyton-Klinger) from the 4 balance-derived ones.
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
          tip={`${cfg?.label ?? strategy}: ${cfg?.description ?? "its own yearly rule"}. See Strategy Params for this strategy's own parameters — not the rate above.`}
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
                ? `Starting Retirement budget — your ${cfg.label} strategy starts from this figure and adjusts it each year.`
                : `Starting Retirement budget — ${cfg?.label ?? strategy} sizes spending from your balance (RMD-Based only from the RMD age); this is the need its spending is checked against.`
              : undefined
          }
          highlight
        />
      )}
    </>
  );
}

export type InflationRiskRowProps = {
  draftInflationStdDev: string;
  editingInflation: boolean;
  inputs: SimulationInputs;
  onInflationRiskChange: ((stdDev: number) => void) | undefined;
  setDraftInflationStdDev: Dispatch<SetStateAction<string>>;
  setEditingInflation: Dispatch<SetStateAction<boolean>>;
};

export function InflationRiskRow({
  draftInflationStdDev,
  editingInflation,
  inputs,
  onInflationRiskChange,
  setDraftInflationStdDev,
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
            value={draftInflationStdDev}
            onChange={(e) => setDraftInflationStdDev(e.target.value)}
            className="text-caption w-12 rounded border px-0.5 py-0.5 text-center focus:border-blue-400 focus:outline-none"
          />
          <span className="text-faint text-caption">%</span>
          <button
            type="button"
            onClick={() => {
              if (onInflationRiskChange) {
                onInflationRiskChange(parseFloat(draftInflationStdDev) / 100);
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
                setDraftInflationStdDev(
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
