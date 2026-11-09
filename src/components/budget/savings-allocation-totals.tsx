import type { RouterOutputs } from "@/lib/trpc";
import type { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";

/** The stored allocations' total beside the live pool. */
export function renderStoredTotal(
  livePoolEstimate: number,
  rows: RouterOutputs["savings"]["goalProfileAllocations"]["list"],
) {
  const storedTotal = sumBy(rows, (r) => r.monthlyContribution);
  const diff = livePoolEstimate - storedTotal;
  return (
    <span className="text-faint">
      · stored allocations total {formatCurrency(storedTotal)}/mo
      {Math.abs(diff) > 0.01 && (
        <span
          className={diff > 0 ? "ml-1 text-emerald-600" : "ml-1 text-red-600"}
        >
          ({diff > 0 ? "+" : ""}
          {formatCurrency(diff)} {diff > 0 ? "unspent" : "over"})
        </span>
      )}
    </span>
  );
}

/** A profile row's allocated and unspent monthly totals. */
export function renderProfileTotals(
  p: NonNullable<ReturnType<typeof useBudgetProfilesList>["data"]>[number],
  summary: RouterOutputs["savings"]["goalProfileAllocations"]["listSummaries"][number],
) {
  const isWeighted = !!p.columnMonths && p.columnMonths.length > 0;
  // Weighted profiles blend to a "typical month" across
  // modes — both this profile's spending AND its take-home
  // pay are blended the same way, server-side.
  const unspent = p.unspentMonthly;
  return (
    <div className="text-caption text-muted mt-0.5 space-y-0.5">
      <div className="flex gap-2">
        <span>
          Allocated: {formatCurrency(summary.totalMonthlyAllocation)}/mo
        </span>
        {summary.fundedGoalCount > 0 && (
          <span>
            {summary.fundedGoalCount} goal
            {summary.fundedGoalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {unspent != null && (
        <div>
          Unspent{isWeighted ? " (blended)" : ""}:{" "}
          <span className={unspent >= 0 ? "text-emerald-600" : "text-red-600"}>
            {formatCurrency(unspent)}/mo
          </span>
        </div>
      )}
    </div>
  );
}
