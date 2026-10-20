"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { useProjectedFiYear } from "@/lib/hooks/use-dashboard-projection";

export function FinancialIndependenceCard({
  fiTarget,
  fiProgress,
  portfolioTotal,
  cash,
  withdrawalRate,
  withdrawalRateIsDefault,
  budgetColumnLabels,
  currentExpenseColumn,
  onExpenseColumnChange,
}: {
  fiTarget: number;
  fiProgress: number;
  portfolioTotal: number;
  cash: number;
  withdrawalRate: number;
  withdrawalRateIsDefault?: boolean;
  budgetColumnLabels?: string[];
  currentExpenseColumn: number;
  onExpenseColumnChange: (index: number) => void;
}) {
  const projected = useProjectedFiYear(fiTarget, cash);
  return (
    <Card
      title={
        <>
          Financial Independence{" "}
          <HelpTip text="The amount you need invested so that your withdrawal rate (set in Retirement settings) covers your expenses indefinitely." />
        </>
      }
      className="mb-6"
    >
      <div className="space-y-3 text-sm">
        {budgetColumnLabels && budgetColumnLabels.length > 1 && (
          <div className="border-subtle flex items-center justify-between border-b py-2">
            <span className="text-muted">
              Expense Scenario{" "}
              <HelpTip text="Choose which budget scenario to use for calculating your FI target" />
            </span>
            <div className="flex gap-1">
              {budgetColumnLabels.map((label: string, index: number) => (
                <button
                  key={label}
                  onClick={() => onExpenseColumnChange(index)}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    index === currentExpenseColumn
                      ? "bg-blue-600 text-white"
                      : "bg-surface-elevated text-muted hover:bg-surface-strong"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="border-subtle flex justify-between border-b py-2">
          <span className="text-muted">Annual Expenses</span>
          <span className="font-medium">
            {formatCurrency(fiTarget * withdrawalRate)}
          </span>
        </div>
        <div className="border-subtle flex justify-between border-b py-2">
          <span className="text-muted">
            Withdrawal Rate{" "}
            <HelpTip text="Set in Retirement settings. Applied to your portfolio to determine FI target (expenses / rate)." />
          </span>
          <span className="text-right font-medium">
            {formatPercent(withdrawalRate)}
            {withdrawalRateIsDefault && (
              <span className="block text-xs font-normal text-amber-600 dark:text-amber-400">
                using default {formatPercent(withdrawalRate, 1)} — configure in
                Retirement settings
              </span>
            )}
          </span>
        </div>
        <div className="border-subtle flex justify-between border-b py-2">
          <span className="text-muted">
            FI Target (expenses / withdrawal rate)
          </span>
          <span className="font-medium">{formatCurrency(fiTarget)}</span>
        </div>
        <div className="border-subtle flex justify-between border-b py-2">
          <span className="text-muted">Portfolio + Cash</span>
          <span className="font-medium">
            {formatCurrency(portfolioTotal + cash)}
          </span>
        </div>
        <div className="flex justify-between py-2 font-semibold">
          <span>Progress</span>
          <span
            className={fiProgress >= 1 ? "text-green-700" : "text-blue-700"}
          >
            {formatPercent(fiProgress)}
          </span>
        </div>
        <div className="border-subtle text-muted border-t py-2 text-xs">
          <div className="flex justify-between">
            <span>
              Projected FI Year{" "}
              <HelpTip text="The year your investments plus cash reach the FI target in your retirement plan's projection. The target grows with inflation, since the projection is in future dollars." />
            </span>
            <span className="text-primary font-medium">
              {fiProgress >= 1
                ? "Reached"
                : projected.isLoading
                  ? "…"
                  : !projected.hasProjection
                    ? "Set up retirement"
                    : projected.fi === null
                      ? "Not reached in the projection"
                      : `${projected.fi.year} (age ${Math.round(projected.fi.age)})`}
            </span>
          </div>
          {projected.fi !== null && fiProgress < 1 && (
            <div className="text-caption text-faint mt-0.5 text-right">
              Based on retirement plan
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
