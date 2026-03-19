/**
 * Budget Calculator
 *
 * Aggregates monthly budget items by category and computes essential vs. discretionary totals.
 *
 * Budget items support multiple "columns" representing different spending scenarios:
 *   - Column 0: Standard (normal monthly spending)
 *   - Column 1: Tight (reduced spending for savings goals)
 *   - Column 2: Emergency (bare minimum survival spending)
 * The `selectedColumn` index determines which scenario's amounts are used.
 *
 * Each item is flagged as essential or discretionary. Essential items are things like rent,
 * utilities, and groceries. Discretionary items are things like dining out and entertainment.
 * This split feeds into the savings calculator (essential expenses determine e-fund coverage)
 * and retirement projections (annual expenses).
 *
 * The `amounts` array on each item MUST match the length of `columnLabels` — this is validated
 * via Zod `.refine()` on every database write.
 */
import type { BudgetInput, BudgetResult } from "./types";
import { roundToCents, sumBy } from "../utils/math";

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
