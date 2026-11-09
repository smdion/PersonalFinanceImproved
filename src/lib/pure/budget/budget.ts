/**
 * Budget totals by category, essential vs discretionary, for the `selectedColumn` scenario
 * (each item's `amounts` has one value per `columnLabels` entry, validated on write).
 */
import type { BudgetInput, BudgetResult } from "./budget.types";
import { roundToCents, sumBy } from "../../utils/math";

export function calculateBudget(input: BudgetInput): BudgetResult {
  const warnings: string[] = [];

  if (input.columnLabels.length === 0) {
    warnings.push("No budget columns defined");
    return {
      totalMonthly: 0,
      essentialTotal: 0,
      discretionaryTotal: 0,
      categories: [],
      warnings,
    };
  }

  // Use the selected budget scenario column (e.g. Standard=0, Tight=1, Emergency=2)
  const col = input.selectedColumn;

  // Group items by category (e.g. "Housing", "Transportation", "Food")
  const categoryMap = new Map<
    string,
    { label: string; amount: number; isEssential: boolean }[]
  >();

  for (const item of input.items) {
    if (col >= item.amounts.length) {
      warnings.push(
        `Budget item "${item.label}" has ${item.amounts.length} columns but column ${col} was requested — using $0`,
      );
    }
    const amount = item.amounts[col] ?? 0;
    if (!categoryMap.has(item.category)) {
      categoryMap.set(item.category, []);
    }
    categoryMap.get(item.category)!.push({
      label: item.label,
      amount: roundToCents(amount),
      isEssential: item.isEssential,
    });
  }

  // Build category summaries with per-item breakdown
  const categories = Array.from(categoryMap.entries()).map(([name, items]) => ({
    name,
    total: roundToCents(sumBy(items, (i) => i.amount)),
    items: items.map((i) => ({
      label: i.label,
      amount: i.amount,
      isEssential: i.isEssential,
    })),
  }));

  // Split totals: essential (needs) vs. discretionary (wants)
  const totalMonthly = roundToCents(sumBy(categories, (c) => c.total));
  const essentialTotal = roundToCents(
    sumBy(
      input.items.filter((i) => i.isEssential),
      (i) => roundToCents(i.amounts[col] ?? 0),
    ),
  );
  const discretionaryTotal = roundToCents(totalMonthly - essentialTotal);

  return {
    totalMonthly,
    essentialTotal,
    discretionaryTotal,
    categories,
    warnings,
  };
}
