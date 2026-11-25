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

/** A plain decimal ("500", "-20.25", ".5"): not hex, binary or an exponent. */
const DECIMAL_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/;

/** A stored amount as read: a number, or decimal text ("500", as tag 0018
 *  left some) as its number; null for anything else, which counts as $0 and
 *  is named. Never read as text, so a sum never concatenates. */
export function storedBudgetAmount(stored: unknown): number | null {
  if (typeof stored === "number") return stored;
  return typeof stored === "string" && DECIMAL_TEXT.test(stored)
    ? Number(stored)
    : null;
}

/** An item's monthly amount in column `col` of `columns`, null when its stored
 *  value isn't one (`storedBudgetAmount`) or is missing (amounts that aren't a
 *  list, or stop short of `col`). A column outside the list holds no budget: $0. */
export function readableBudgetItemAmount(
  amounts: readonly number[],
  col: number,
  columns: number,
): number | null {
  if (col < 0 || col >= columns) return 0;
  const amount = storedColumnAmount(amounts, col);
  return amount === undefined ? null : storedBudgetAmount(amount);
}

/** An item's stored value in column `col`, as stored; undefined when it has
 *  none (amounts that aren't a list, or stop short of `col`). */
export function storedColumnAmount(
  amounts: readonly number[],
  col: number,
): unknown {
  return storedAmountList(amounts)?.[col];
}

/** `readableBudgetItemAmount`, a value that isn't a number counted as $0
 *  (named by calculateBudget's warnings and the Budget page; FALLBACKS). */
export function budgetItemAmount(
  amounts: readonly number[],
  col: number,
  columns: number,
): number {
  const read = readableBudgetItemAmount(amounts, col, columns);
  return read === null ? 0 : read;
}

/** A copy of an item's stored amounts for a writer, each kept as stored (text
 *  too); null when they aren't a list (written outside the app). */
export function storedAmountList(stored: readonly number[]): number[] | null {
  const value: unknown = stored;
  return Array.isArray(value) ? [...stored] : null;
}

/** `storedAmountList` for a writer of column `col` alone (the pull): null
 *  when the list has no place for that column, so nothing else shifts. */
export function amountListWithColumn(
  stored: readonly number[],
  col: number,
): number[] | null {
  const list = storedAmountList(stored);
  return list !== null && col >= 0 && col < list.length ? list : null;
}

/** The items' monthly total in column `col` of `columns` (see budgetItemAmount). */
export function budgetColumnSum(
  items: readonly { amounts: readonly number[] }[],
  col: number,
  columns: number,
): number {
  return sumBy(items, (item) => budgetItemAmount(item.amounts, col, columns));
}
