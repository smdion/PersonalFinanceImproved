/** The budget summary's Savings rows and their blended column's cells. */
import type { Dispatch, SetStateAction } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { RowToggle } from "./budget-summary-row-toggle";
import type { PayrollBreakdown, ColumnResult, SinkingFundLine } from "./types";
import { computeTotalSinking, computeUnallocated } from "./helpers";

/** The blended column's savings, and how far sinking funds overrun it. */
export function renderBlendedSavingsCell(
  blended: (values: (number | null)[]) => number,
  allColumnResults: ColumnResult[],
  payrollBreakdowns: (PayrollBreakdown | null)[],
  totalSinking: number,
  blendedCellClass: string,
) {
  const blendedSavings = blended(
    allColumnResults.map(
      (r, i) => (payrollBreakdowns[i]?.netMonthly ?? 0) - r.totalMonthly,
    ),
  );
  const blendedOverage = totalSinking - blendedSavings;
  const isOverCapacity = blendedOverage > 0.01;
  return (
    <td
      className={`${blendedCellClass} ${blendedSavings >= 0 ? "text-emerald-700" : "text-red-600"}`}
    >
      {formatCurrency(blendedSavings)}
      {isOverCapacity && (
        <div className="text-micro mt-0.5 leading-tight font-normal text-red-500">
          ⚠ {formatCurrency(blendedOverage)} over
        </div>
      )}
    </td>
  );
}

/** The blended column's unallocated remainder. */
export function renderBlendedUnallocatedCell(
  blended: (values: (number | null)[]) => number,
  payrollBreakdowns: (PayrollBreakdown | null)[],
  allColumnResults: ColumnResult[],
  totalSinking: number,
) {
  const blendedUnallocated = computeUnallocated(
    blended(payrollBreakdowns.map((b) => b?.netMonthly ?? 0)),
    blended(allColumnResults.map((r) => r.totalMonthly)),
    totalSinking,
  );
  return (
    <td
      className={`text-caption bg-surface-sunken/60 px-2 py-0.5 text-right tabular-nums ${blendedUnallocated >= 0 ? "text-emerald-600" : "text-red-500"}`}
    >
      {formatCurrency(blendedUnallocated)}
    </td>
  );
}

/** The Savings row, with its sinking funds and unallocated remainder when opened. */
export function renderSavingsRows(
  sinkingFunds: SinkingFundLine[] | undefined,
  setShowSavings: Dispatch<SetStateAction<boolean>>,
  showSavings: boolean,
  savingsProfileName: string | undefined,
  allColumnResults: ColumnResult[],
  payrollBreakdowns: (PayrollBreakdown | null)[],
  isWeighted: boolean,
  cols: string[],
  blended: (values: (number | null)[]) => number,
  blendedCellClass: string,
) {
  const totalSinking = computeTotalSinking(sinkingFunds);
  const hasSinkingFunds = sinkingFunds && sinkingFunds.length > 0;
  return (
    <>
      <tr
        className={`font-bold${hasSinkingFunds ? "hover:bg-surface-sunken cursor-pointer" : ""}`}
        onClick={
          hasSinkingFunds ? () => setShowSavings(!showSavings) : undefined
        }
      >
        <td className="py-1.5 pr-3 text-emerald-700">
          <span className="flex items-center gap-1.5">
            {hasSinkingFunds ? (
              <RowToggle open={showSavings} row="savings" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            )}
            Savings
            {savingsProfileName && (
              <span className="text-micro text-faint font-normal">
                ({savingsProfileName})
              </span>
            )}
            <HelpTip text="Take-home pay minus all budgeted expenses. Sinking fund commitments and allocations below reflect the budget profile named above. Expanding shows sinking fund commitments and the unallocated remainder." />
          </span>
        </td>
        {allColumnResults.map((r, i) => {
          const netMonthly = payrollBreakdowns[i]?.netMonthly ?? 0;
          const totalSavings = netMonthly - r.totalMonthly;
          const overage =
            payrollBreakdowns[i] !== null ? totalSinking - totalSavings : 0;
          // In weighted profiles, a single mode running "over"
          // (e.g. a one-month travel splurge) doesn't mean
          // savings capacity is actually blown for the year —
          // only the blended column's warning reflects that.
          const isOverCapacity = !isWeighted && overage > 0.01;
          return (
            <td
              key={cols[i]}
              className={`px-2 py-1.5 text-right tabular-nums ${totalSavings >= 0 ? "text-emerald-700" : "text-red-600"}`}
            >
              {formatCurrency(totalSavings)}
              {isOverCapacity && (
                <div className="text-micro mt-0.5 leading-tight text-red-500">
                  ⚠ {formatCurrency(overage)} over → fix in Savings
                </div>
              )}
            </td>
          );
        })}
        {isWeighted &&
          renderBlendedSavingsCell(
            blended,
            allColumnResults,
            payrollBreakdowns,
            totalSinking,
            blendedCellClass,
          )}
      </tr>
      {showSavings && hasSinkingFunds && (
        <>
          {sinkingFunds.map((fund) => (
            <tr
              key={fund.id}
              className="border-subtle bg-surface-sunken/50 border-b"
            >
              <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                {fund.name}
              </td>
              {allColumnResults.map((_, i) => (
                <td
                  key={cols[i]}
                  className="text-caption px-2 py-0.5 text-right text-amber-500 tabular-nums"
                >
                  {formatCurrency(fund.monthlyContribution)}
                </td>
              ))}
              {isWeighted && (
                <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-amber-500 tabular-nums">
                  {formatCurrency(fund.monthlyContribution)}
                </td>
              )}
            </tr>
          ))}
          <tr className="border-subtle bg-surface-sunken/50 border-b">
            <td className="text-faint text-caption py-0.5 pr-3 pl-8">
              Unallocated
            </td>
            {allColumnResults.map((r, i) => {
              const unallocated = computeUnallocated(
                payrollBreakdowns[i]?.netMonthly ?? 0,
                r.totalMonthly,
                totalSinking,
              );
              return (
                <td
                  key={cols[i]}
                  className={`text-caption px-2 py-0.5 text-right tabular-nums ${unallocated >= 0 ? "text-emerald-600" : "text-red-500"}`}
                >
                  {formatCurrency(unallocated)}
                </td>
              );
            })}
            {isWeighted &&
              renderBlendedUnallocatedCell(
                blended,
                payrollBreakdowns,
                allColumnResults,
                totalSinking,
              )}
          </tr>
        </>
      )}
    </>
  );
}
