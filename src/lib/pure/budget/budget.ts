/**
 * Budget totals by category, essential vs discretionary, for the `selectedColumn` scenario
 * (each item's `amounts` has one value per `columnLabels` entry: the writers and the money
 * migration keep it).
 */
import type { BudgetInput, BudgetResult } from "./budget.types";
import { roundToCents, sumBy } from "../../utils/math";
import { budgetItemAmount } from "./item-amount";

const NO_BUDGET = {
  totalMonthly: 0,
  essentialTotal: 0,
  discretionaryTotal: 0,
  categories: [],
};

export function calculateBudget(input: BudgetInput): BudgetResult {
  const warnings: string[] = [];
  const columns = input.columnLabels.length;

  if (columns === 0) {
    warnings.push("No budget columns defined");
    return { ...NO_BUDGET, warnings };
  }

  // Use the selected budget scenario column (e.g. Standard=0, Tight=1, Emergency=2)
  const col = input.selectedColumn;
  if (col < 0 || col >= columns) {
    warnings.push(`Column ${col} was requested of ${columns} — using $0`);
    return { ...NO_BUDGET, warnings };
  }

  // Group items by category (e.g. "Housing", "Transportation", "Food")
  const categoryMap = new Map<
    string,
    { label: string; amount: number; isEssential: boolean }[]
  >();

  for (const item of input.items) {
    const amount = budgetItemAmount(item.amounts, col, columns);
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
      (i) => roundToCents(budgetItemAmount(i.amounts, col, columns)),
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
