import { partsSummary } from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** Each group's budgeted and actual bars, as their tooltip shows them. */
export function budgetVsActualSummary(
  groups: readonly { name: string; budgeted: number; actual: number }[],
) {
  return partsSummary(
    "Budget vs actual by group",
    groups.map(
      (g) =>
        [
          g.name,
          `budgeted ${formatCurrency(g.budgeted)}, actual ${formatCurrency(g.actual)}`,
        ] as const,
    ),
  );
}
