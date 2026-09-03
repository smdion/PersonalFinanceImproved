"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { FICache } from "@/lib/hooks/use-fi-cache";

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
  fiCache,
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
  fiCache: FICache;
}) {
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
              <HelpTip text="Projected year your portfolio reaches your FI target, based on your retirement plan. Visit the Retirement page to run a projection." />
            </span>
            <span className="text-primary font-medium">
              {fiCache === null ? (
                <a href="/retirement" className="text-blue-600 hover:underline">
                  Run projection →
                </a>
              ) : fiCache.fiYear === null ? (
                "Unreachable"
              ) : (
                `${fiCache.fiYear}${fiCache.fiAge !== null ? ` (age ${fiCache.fiAge})` : ""}`
              )}
            </span>
          </div>
          {fiCache !== null && fiCache.fiYear !== null && (
            <div className="text-caption text-faint mt-0.5 text-right">
              Based on retirement plan
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
