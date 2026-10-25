"use client";

import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { FULL_SHARE } from "@/lib/constants";
import { COST_KINDS } from "@/lib/config/performance-help";
import { allInYearlyCost } from "@/lib/pure/performance";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";

/**
 * What investing costs, as two kinds that are never mixed: fund costs
 * (expense ratios, inside the funds' prices — a rate on today's balance)
 * and account fees (charged to the accounts — actual amounts recorded in
 * Performance). The headline adds a year of each.
 */
export function WhatItCostsCard({
  cost,
  accountFees,
  invested,
}: {
  cost: {
    expenseRatio: number | null;
    yearlyCost: number;
    coveredShare: number;
  };
  accountFees: {
    year: number;
    thisYear: number | null;
    lastYear: number | null;
  };
  /** Value of the holdings the fund costs are measured on. */
  invested: number;
}) {
  const fundYearly = cost.expenseRatio === null ? null : cost.yearlyCost;
  const allIn = allInYearlyCost(fundYearly, accountFees);
  const feesYearShown =
    accountFees.lastYear !== null ? accountFees.year - 1 : accountFees.year;

  return (
    <Card
      title="What it costs"
      headerRight={
        allIn !== null ? (
          <div className="text-right">
            <div className="text-primary text-sm font-semibold">
              about {formatCurrency(allIn, 0)} a year
            </div>
            {invested > 0 && (
              <div className="text-caption text-faint">
                {formatPercent(safeDivide(allIn, invested), 2)} of{" "}
                {formatCurrency(invested, 0)}
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3 text-sm">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-primary font-medium">
              {COST_KINDS.fundCosts.label}
              <HelpTip text={COST_KINDS.fundCosts.help} />
            </span>
            {cost.expenseRatio === null ? (
              <span className="text-faint">not known yet</span>
            ) : (
              <span className="text-primary tabular-nums">
                {formatPercent(cost.expenseRatio, 3)} · about{" "}
                {formatCurrency(cost.yearlyCost, 0)} a year
              </span>
            )}
          </div>
          <p className="text-caption text-muted">
            {cost.expenseRatio === null
              ? "Expense ratios come from SEC filings or your own entries."
              : "Taken inside the funds' prices — already in your returns, never charged as a line item."}
            {cost.expenseRatio !== null &&
              cost.coveredShare < FULL_SHARE &&
              ` Covers ${formatPercent(cost.coveredShare, 0)} of your money (funds without a known expense ratio aren't included).`}
          </p>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-primary font-medium">
              {COST_KINDS.accountFees.label}
              <HelpTip text={COST_KINDS.accountFees.help} />
            </span>
            <span className="text-primary tabular-nums">
              {accountFees.lastYear === null && accountFees.thisYear === null
                ? "none recorded"
                : [
                    accountFees.lastYear !== null &&
                      `${accountFees.year - 1}: ${formatCurrency(accountFees.lastYear, 0)}`,
                    accountFees.thisYear !== null &&
                      `${accountFees.year} so far: ${formatCurrency(accountFees.thisYear, 0)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </div>
          <p className="text-caption text-muted">
            Charged to the accounts (recordkeeping, admin, tax withheld) —
            recorded in Performance → Fees.
          </p>
        </div>
        {allIn !== null && (
          <p className="text-caption text-faint border-subtle border-t pt-2">
            The total adds a year of fund costs at today&apos;s balance to{" "}
            {feesYearShown}&apos;s account fees.
          </p>
        )}
      </div>
    </Card>
  );
}
