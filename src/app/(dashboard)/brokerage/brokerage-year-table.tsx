/** The Brokerage page's year-by-year projection table and its tooltips. */
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { type BrokerageGoalYear } from "@/lib/pure/savings/brokerage-goals";
import type { TooltipData } from "@/components/retirement-projection/types";
import { renderTooltip } from "@/components/retirement-projection/tooltip-renderer";
import { safeDivide } from "@/lib/utils/math";
import { YearTableHead } from "./brokerage-year-table-head";

// --- Tooltip builders ---

function contributionTooltip(yearRow: BrokerageGoalYear): TooltipData {
  const items = yearRow.individualAccounts.map((ia) => ({
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
      amount: yearRow.contribution,
      match: yearRow.employerMatch > 0 ? yearRow.employerMatch : undefined,
      matchLabel: "match",
    },
    ...(yearRow.proRateFraction != null
      ? {
          proRate: {
            months: Math.round(yearRow.proRateFraction * 12),
            annualAmount: Math.round(
              safeDivide(yearRow.contribution, yearRow.proRateFraction!),
            ),
            proRatedAmount: yearRow.contribution,
          },
        }
      : {}),
  };
}

function overflowTooltip(yearRow: BrokerageGoalYear): TooltipData {
  const items = yearRow.individualAccounts
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

function growthTooltip(yearRow: BrokerageGoalYear): TooltipData {
  const items = yearRow.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.growth,
    prefix: (ia.growth >= 0 ? "+" : "-") as "+" | "-",
    color: "emerald" as const,
  }));
  return {
    kind: "money",
    header: "Investment Growth",
    meta: `Return rate: ${formatPercent(yearRow.returnRate)}`,
    items,
    growth: { amount: yearRow.growth },
  };
}

function withdrawalTooltip(yearRow: BrokerageGoalYear): TooltipData {
  const items = yearRow.goalWithdrawals.map((gw) => ({
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
    withdrawals: {
      amount: yearRow.totalWithdrawal,
      taxCost: yearRow.totalTaxCost,
    },
  };
}

function balanceTooltip(
  yearRow: BrokerageGoalYear,
  prevBalance: number,
): TooltipData {
  const items = yearRow.individualAccounts.map((ia) => ({
    label: ia.name,
    amount: ia.balance,
    color: "blue" as const,
  }));
  const change = yearRow.endBalance - prevBalance;
  return {
    kind: "money",
    header: "End Balance",
    meta: `Return rate: ${formatPercent(yearRow.returnRate)}`,
    items,
    yearChange: {
      total: yearRow.endBalance,
      change,
      parts: [
        {
          label: "Contributions",
          amount: yearRow.contribution + yearRow.overflow,
          color: "blue",
        },
        { label: "Growth", amount: yearRow.growth, color: "emerald" },
        ...(yearRow.totalWithdrawal > 0
          ? [
              {
                label: "Withdrawals",
                amount: -yearRow.totalWithdrawal,
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
        <YearTableHead />
        <tbody>
          {years.map((yearRow, index) => {
            const hasWithdrawals = yearRow.totalWithdrawal > 0;
            const prevBalance = index > 0 ? years[index - 1]!.endBalance : 0;
            const hasAccounts = yearRow.individualAccounts.length > 0;
            return (
              <tr
                key={yearRow.year}
                className={`border-subtle border-b ${
                  hasWithdrawals ? "bg-amber-50/50" : ""
                }`}
              >
                <td className="text-secondary py-1.5 pr-3 font-medium">
                  {yearRow.year}
                  {yearRow.proRateFraction != null && (
                    <span className="text-micro text-faint ml-1">
                      ({Math.round(yearRow.proRateFraction * 12)} months)
                    </span>
                  )}
                </td>
                <td className="text-muted py-1.5 pr-3 text-right">
                  {yearRow.contribution > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(contributionTooltip(yearRow))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yearRow.contribution, yearRow.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yearRow.contribution, yearRow.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-amber-600">
                  {yearRow.overflow > 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(overflowTooltip(yearRow))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yearRow.overflow, yearRow.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yearRow.overflow, yearRow.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-emerald-600">
                  {yearRow.growth !== 0 ? (
                    hasAccounts ? (
                      <Tooltip
                        content={renderTooltip(growthTooltip(yearRow))}
                        side="top"
                      >
                        <span className="cursor-help border-b border-dotted border-current">
                          {fmt(yearRow.growth, yearRow.year)}
                        </span>
                      </Tooltip>
                    ) : (
                      fmt(yearRow.growth, yearRow.year)
                    )
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-red-600">
                  {yearRow.totalWithdrawal > 0 ? (
                    <Tooltip
                      content={renderTooltip(withdrawalTooltip(yearRow))}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        -{fmt(yearRow.totalWithdrawal, yearRow.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td className="text-muted py-1.5 pr-3 text-right">
                  {yearRow.totalTaxCost > 0
                    ? fmt(yearRow.totalTaxCost, yearRow.year)
                    : "\u2014"}
                </td>
                <td className="text-primary py-1.5 pr-3 text-right font-medium">
                  {hasAccounts ? (
                    <Tooltip
                      content={renderTooltip(
                        balanceTooltip(yearRow, prevBalance),
                      )}
                      side="top"
                    >
                      <span className="cursor-help border-b border-dotted border-current">
                        {fmt(yearRow.endBalance, yearRow.year)}
                      </span>
                    </Tooltip>
                  ) : (
                    fmt(yearRow.endBalance, yearRow.year)
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
