/**
 * Expense Year-over-Year Calculator (Migration Plan 5.9)
 *
 * Compares spending between two periods (current vs prior) at both category and
 * subcategory levels. Computes dollar and percentage changes.
 *
 * Inputs come from YNAB transaction data (Phase 4). The calculator itself is pure —
 * it just compares two sets of category totals. Testing is deferred until YNAB
 * integration provides real data.
 */
import type { ExpenseYoYInput, ExpenseYoYResult } from "./types";
import { safeDivide, roundToCents, sumBy } from "../utils/math";

export function calculateExpenseYoY(input: ExpenseYoYInput): ExpenseYoYResult {
  const warnings: string[] = [];

  if (input.currentPeriod.length === 0) {
    warnings.push("No current period data available");
  }
  if (input.priorPeriod.length === 0) {
    warnings.push("No prior period data available");
  }

  // Collect all unique categories across both periods
  const allCategories = new Set<string>();
  for (const item of [...input.currentPeriod, ...input.priorPeriod]) {
    allCategories.add(item.category);
  }

  const categories = Array.from(allCategories)
    .sort()
    .map((category) => {
      const currentItems = input.currentPeriod.filter(
        (i) => i.category === category,
      );
      const priorItems = input.priorPeriod.filter(
        (i) => i.category === category,
      );
      const currentTotal = roundToCents(sumBy(currentItems, (i) => i.amount));
      const priorTotal = roundToCents(sumBy(priorItems, (i) => i.amount));
      const dollarChange = roundToCents(currentTotal - priorTotal);
      const percentChange = safeDivide(dollarChange, priorTotal, null) as
        | number
        | null;

      // Subcategory breakdown
      const allSubcats = new Set<string>();
      for (const item of [...currentItems, ...priorItems]) {
        allSubcats.add(item.subcategory);
      }

      const subcategories = Array.from(allSubcats)
        .sort()
        .map((subcategory) => {
          const current = roundToCents(
            sumBy(
              currentItems.filter((i) => i.subcategory === subcategory),
              (i) => i.amount,
            ),
          );
          const prior = roundToCents(
            sumBy(
              priorItems.filter((i) => i.subcategory === subcategory),
              (i) => i.amount,
            ),
          );
          return {
            subcategory,
            current,
            prior,
            dollarChange: roundToCents(current - prior),
            percentChange: safeDivide(current - prior, prior, null) as
              | number
              | null,
          };
        });

      return {
        category,
        currentTotal,
        priorTotal,
        dollarChange,
        percentChange,
        subcategories,
      };
    });

  const grandCurrentTotal = roundToCents(
    sumBy(categories, (c) => c.currentTotal),
  );
  const grandPriorTotal = roundToCents(sumBy(categories, (c) => c.priorTotal));
  const grandDollarChange = roundToCents(grandCurrentTotal - grandPriorTotal);
  const grandPercentChange = safeDivide(
    grandDollarChange,
    grandPriorTotal,
    null,
  ) as number | null;

  return {
    categories,
    grandCurrentTotal,
    grandPriorTotal,
    grandDollarChange,
    grandPercentChange,
    warnings,
  };
}
