import { roundToCents } from "@/lib/utils/math";

/**
 * Compute annualized total for a specific budget column from an array of
 * budget items. Each item's `amounts` array holds monthly values per column.
 * Used for tier-mode profiles (pick one column, × 12).
 */
export function computeBudgetColumnTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
): number {
  const monthlyTotal = items.reduce(
    (sum, item) => sum + (item.amounts[columnIndex] ?? 0),
    0,
  );
  return roundToCents(monthlyTotal * 12);
}

/**
 * Compute annualized total for a weighted-months profile.
 * Each column's monthly total is multiplied by its month weight.
 * Annual = sum(column_monthly_total × column_months[col])
 */
export function computeWeightedBudgetTotal(
  items: { amounts: number[] }[],
  columnMonths: number[],
): number {
  let annual = 0;
  for (let col = 0; col < columnMonths.length; col++) {
    const monthlyTotal = items.reduce(
      (sum, item) => sum + (item.amounts[col] ?? 0),
      0,
    );
    annual += monthlyTotal * (columnMonths[col] ?? 0);
  }
  return roundToCents(annual);
}

/**
 * Compute the correct annual total for a profile, handling both modes:
 * - Weighted profiles (columnMonths set): weighted combination of all columns
 * - Tier profiles (columnMonths null): single column × 12
 */
export function computeBudgetAnnualTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
  columnMonths: number[] | null,
): number {
  if (columnMonths) return computeWeightedBudgetTotal(items, columnMonths);
  return computeBudgetColumnTotal(items, columnIndex);
}
