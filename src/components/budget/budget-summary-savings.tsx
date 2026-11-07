/** The budget summary's Savings rows: the blended column's cells. */
import { formatCurrency } from "@/lib/utils/format";
import type { PayrollBreakdown, ColumnResult } from "./types";
import { computeUnallocated } from "./helpers";

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
