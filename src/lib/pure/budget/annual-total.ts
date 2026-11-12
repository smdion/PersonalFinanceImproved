import { roundToCents } from "@/lib/utils/math";
import { budgetColumnSum, type BudgetColumns } from "./item-amount";

/**
 * Compute annualized total for a specific budget column from an array of
 * budget items. Each item's `amounts` array holds monthly values per column.
 * Used for tier-mode profiles (pick one column, × 12).
 */
export function computeBudgetColumnTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
  columns: number,
): number {
  return roundToCents(budgetColumnSum(items, columnIndex, columns) * 12);
}

/**
 * Compute annualized total for a weighted-months profile.
 * Each column's monthly total is multiplied by its month weight.
 * Annual = sum(column_monthly_total × column_months[col])
 */
export function computeWeightedBudgetTotal(
  items: { amounts: number[] }[],
  columnMonths: number[],
  columns: number,
): number {
  let annual = 0;
  for (let col = 0; col < columnMonths.length; col++) {
    const monthlyTotal = budgetColumnSum(items, col, columns);
    annual += monthlyTotal * (columnMonths[col] ?? 0);
  }
  return roundToCents(annual);
}

/**
 * Compute the correct annual total for a profile's items, handling both modes:
 * - Weighted profiles (columnMonths set): weighted combination of all columns
 * - Tier profiles (columnMonths null): single column × 12 (no profile: none)
 */
export function computeBudgetAnnualTotal(
  items: { amounts: number[] }[],
  columnIndex: number,
  profile: BudgetColumns | undefined,
): number {
  const columns = profile ? profile.columnLabels.length : 0;
  if (profile?.columnMonths)
    return computeWeightedBudgetTotal(items, profile.columnMonths, columns);
  return computeBudgetColumnTotal(items, columnIndex, columns);
}
