"use client";

/**
 * Which budget the retirement projection spends — before and after
 * retirement — read from the projection itself, so the Budget page says
 * how it feeds the plan.
 */
import Link from "next/link";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { formatCurrency } from "@/lib/utils/format";
import {
  WITHDRAWAL_STRATEGY_CONFIG,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

export function BudgetRetirementNote() {
  const { data, engineInput } = useDashboardProjection();
  const { data: profiles } = useBudgetProfilesList();
  if (!data || !("accumulationBudgetProfileId" in data)) return null;
  const phase = (
    profileId: number | null,
    column: number,
    yearly: number | null,
  ) => {
    const p = profiles?.find((x) => x.id === profileId);
    if (!p) return null;
    const label = (p.columnLabels as string[] | null)?.[column];
    return `${p.name}${label ? ` · ${label}` : ""}${yearly != null ? ` (${formatCurrency(yearly)} a year)` : ""}`;
  };
  const setBefore = engineInput?.selection.accumulationBudget?.annualExpenses;
  const before =
    setBefore != null
      ? `${formatCurrency(setBefore)} a year (an amount you set)`
      : phase(
          data.accumulationBudgetProfileId,
          data.accumulationBudgetColumn,
          data.accumulationExpenses,
        );
  // An amount set on Retirement replaces the budget for that phase.
  const setAfter = engineInput?.selection.decumulationBudget?.annualExpenses;
  const after =
    setAfter != null
      ? `${formatCurrency(setAfter)} a year (an amount you set)`
      : phase(
          data.decumulationBudgetProfileId,
          data.decumulationBudgetColumn,
          data.decumulationExpenses,
        );
  // The withdrawal strategy decides what retirement spending really is:
  // the budget itself, a start the portfolio then moves, or a formula on
  // the portfolio that doesn't use the budget at all.
  const strategyKey =
    "settings" in data && data.settings
      ? (data.settings as { withdrawalStrategy?: string }).withdrawalStrategy
      : undefined;
  const strategy =
    strategyKey && strategyKey in WITHDRAWAL_STRATEGY_CONFIG
      ? WITHDRAWAL_STRATEGY_CONFIG[strategyKey as WithdrawalStrategyType]
      : null;
  if (!before && !after) return null;
  const inRetirement =
    after &&
    (strategy?.incomeSource === "formula" ? (
      <>
        ; in retirement your{" "}
        <span className="text-secondary">{strategy.label}</span> withdrawal
        strategy works spending out from the portfolio, so the budget isn&apos;t
        used
      </>
    ) : strategy?.incomeSource === "rate" ? (
      <>
        {" "}
        and starts retirement at <span className="text-secondary">{after}</span>
        , which your <span className="text-secondary">{strategy.label}</span>{" "}
        withdrawal strategy then moves with the portfolio
      </>
    ) : (
      <>
        {" "}
        and <span className="text-secondary">{after}</span> in retirement
      </>
    ));
  return (
    <p className="text-caption text-muted -mt-2 mb-3">
      Your retirement projection spends{" "}
      {before && (
        <>
          <span className="text-secondary">{before}</span> until retirement
        </>
      )}
      {inRetirement} —{" "}
      <Link href="/retirement" className="text-blue-600 hover:underline">
        change these on Retirement
      </Link>
      .
    </p>
  );
}
