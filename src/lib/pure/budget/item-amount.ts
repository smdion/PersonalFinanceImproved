/**
 * One budget item's amount in one column, and a column's monthly sum. Every
 * budget item holds one amount per column of its profile (tag 0018 converted
 * every install and every writer keeps it).
 */
import { sumBy } from "@/lib/utils/math";

/** The parts of a budget profile its annual total reads. */
export type BudgetColumns = {
  columnLabels: readonly string[];
  columnMonths: number[] | null;
};

/** An item's monthly amount in column `col` of `columns`. A column outside the
 *  list (a removed linked or chosen column, or no columns) holds no budget: $0;
 *  an item short of a column of the list is impossible, so it throws. */
export function budgetItemAmount(
  amounts: readonly number[],
  col: number,
  columns: number,
): number {
  if (col < 0 || col >= columns) return 0;
  const amount = amounts[col];
  if (amount === undefined)
    throw new Error(
      `A budget item holds ${amounts.length} amounts for ${columns} columns`,
    );
  return amount;
}

/** The items' monthly total in column `col` of `columns` (see budgetItemAmount). */
export function budgetColumnSum(
  items: readonly { amounts: readonly number[] }[],
  col: number,
  columns: number,
): number {
  return sumBy(items, (item) => budgetItemAmount(item.amounts, col, columns));
}
