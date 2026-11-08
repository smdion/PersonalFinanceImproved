/** The Brokerage page's year-by-year projection table and its tooltips. */
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { type BrokerageGoalYear } from "@/lib/pure/savings/brokerage-goals";
import type { TooltipData } from "@/components/retirement-projection/types";
import { renderTooltip } from "@/components/retirement-projection/tooltip-renderer";
import { safeDivide } from "@/lib/utils/math";

// --- Tooltip builders ---

function contributionTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.intentionalContribution ?? ia.contribution,
    match: ia.employerMatch > 0 ? ia.employerMatch : undefined,
    matchLabel: "employer match",
    color: "blue" as const,
  }));
  return {
    kind: "money",
    header: "Brokerage Contributions",
    items,
    total: {
      label: "Total",
      amount: yr.contribution,
      match: yr.employerMatch > 0 ? yr.employerMatch : undefined,
      matchLabel: "match",
    },
    ...(yr.proRateFraction != null
      ? {
          proRate: {
            months: Math.round(yr.proRateFraction * 12),
            annualAmount: Math.round(
              safeDivide(yr.contribution, yr.proRateFraction!),
            ),
            proRatedAmount: yr.contribution,
          },
        }
      : {}),
  };
}

function overflowTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts
    .filter((ia) => (ia.overflowContribution ?? 0) > 0)
    .map((ia) => ({
      label: ia.name,
      amount: ia.overflowContribution ?? 0,
      color: "amber" as const,
    }));
  return {
    kind: "money",
    header: "IRS Limit Overflow",
    meta: "Excess contributions redirected from retirement accounts",
    items: items.length > 0 ? items : undefined,
  };
}

function growthTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.growth,
    prefix: (ia.growth >= 0 ? "+" : "-") as "+" | "-",
    color: "emerald" as const,
  }));
  return {
    kind: "money",
    header: "Investment Growth",
    meta: `Return rate: ${formatPercent(yr.returnRate)}`,
    items,
    growth: { amount: yr.growth },
  };
}

function withdrawalTooltip(yr: BrokerageGoalYear): TooltipData {
  const items = yr.goalWithdrawals.map((gw) => ({
    label: gw.name,
    amount: gw.amount,
    prefix: "-" as const,
    color: "red" as const,
    sub: [
      {
        label: "Basis (tax-free)",
        amount: gw.basisPortion,
        color: "gray" as const,
      },
      {
        label: "Gains (taxable)",
        amount: gw.gainsPortion,
        color: "amber" as const,
      },
      { label: "Tax cost", amount: gw.taxCost, color: "red" as const },
    ],
  }));
  return {
    kind: "money",
    header: "Goal Withdrawals",
    items,
    withdrawals: { amount: yr.totalWithdrawal, taxCost: yr.totalTaxCost },
  };
}

function balanceTooltip(
  yr: BrokerageGoalYear,
  prevBalance: number,
): TooltipData {
  const items = yr.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.balance,
    color: "blue" as const,
  }));
  const change = yr.endBalance - prevBalance;
  return {
    kind: "money",
    header: "End Balance",
    meta: `Return rate: ${formatPercent(yr.returnRate)}`,
    items,
    yearChange: {
      total: yr.endBalance,
      change,
      parts: [
        {
          label: "Contributions",
          amount: yr.contribution + yr.overflow,
          color: "blue",
        },
        { label: "Growth", amount: yr.growth, color: "emerald" },
        ...(yr.totalWithdrawal > 0
          ? [
              {
                label: "Withdrawals",
                amount: -yr.totalWithdrawal,
                color: "red" as const,
              },
            ]
          : []),
      ],
    },
  };
}

// --- Year-by-Year Table ---

export function YearByYearTable({
  years,
  deflate,
}: {
  years: BrokerageGoalYear[];
  deflate: (value: number, year: number) => number;
}) {
  if (years.length === 0) {
    return <p className="text-faint text-sm">No projection data.</p>;
  }

  // Currency formatting with optional deflation
  const fmt = (amount: number, year: number) =>
    formatCurrency(deflate(amount, year));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-surface-primary sticky top-0 z-10">
          <tr className="text-caption text-faint border-b text-left uppercase">
            <th className="py-2 pr-3">Year</th>
            <th className="py-2 pr-3 text-right">
              Contribution
              <HelpTip text="Intentional brokerage contributions (employee + employer match). Hover for per-account breakdown." />
            </th>
            <th className="py-2 pr-3 text-right">
              Overflow
              <HelpTip text="Excess from retirement accounts that exceed IRS limits, redirected to brokerage" />
            </th>
            <th className="py-2 pr-3 text-right">
              Growth
              <HelpTip text="Investment returns — hover for return rate and per-account breakdown" />
            </th>
            <th className="py-2 pr-3 text-right">
              Withdrawals
              <HelpTip text="Goal withdrawals — hover for per-goal breakdown with tax cost" />
            </th>
            <th className="py-2 pr-3 text-right">
              Tax Cost
              <HelpTip text="Capital gains tax on the gains portion of withdrawals — basis is tax-free" />
            </th>
            <th className="py-2 pr-3 text-right">
              End Balance
              <HelpTip text="Total brokerage account value at year end — hover for breakdown" />
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((yr, index) => {
            const hasWithdrawals = yr.totalWithdrawal > 0;
            const prevBalance = index > 0 ? years[index - 1]!.endBalance : 0;
            const hasAccounts = yr.individualAccounts.length > 0;
            return (
              <tr
                key={yr.year}
                className={`border-subtle border-b ${
                  hasWithdrawals ? "bg-amber-50/50" : ""
                }`}
              >
                <td className="text-secondary py-1.5 pr-3 font-medium">
                  {yr.year}
                  {yr.proRateFraction != null && (
                    <span className="text-micro text-faint ml-1">
                      ({Math.round(yr.proRateFraction * 12)} months)
                    </span>
                  )}
                </td>
                <td className="text-muted py-1.5 pr-3 text-right">
                  {yr.contribution > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(contributionTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.contribution, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.contribution, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-amber-600">
                  {yr.overflow > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(overflowTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.overflow, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.overflow, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-emerald-600">
                  {yr.growth !== 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(growthTooltip(yr))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yr.growth, yr.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yr.growth, yr.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-red-600">
                  {yr.totalWithdrawal > 0 ? (
                    <Tooltip
                      content={renderTooltip(withdrawalTooltip(yr))}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        -{fmt(yr.totalWithdrawal, yr.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="text-muted py-1.5 pr-3 text-right">
                  {yr.totalTaxCost > 0
                    ? fmt(yr.totalTaxCost, yr.year)
                    : "\u2014"}
                </td>
                <td className="text-primary py-1.5 pr-3 text-right font-medium">
                  {hasAccounts ? (
                    <Tooltip
                      content={renderTooltip(balanceTooltip(yr, prevBalance))}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        {fmt(yr.endBalance, yr.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    fmt(yr.endBalance, yr.year)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
