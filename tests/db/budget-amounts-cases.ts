/**
 * Invented budgets for the budget amounts shape (money tag,
 * v0106-budget-amounts.ts): each item's stored amounts, what the shape
 * stores, and what the budget's readers read per column, so the restore
 * step and both migrators are held to one list.
 */
import { calculateBudget } from "@/lib/pure/budget/budget";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";

export const PROFILES = [
  { id: 1, name: "Invented three columns", column_labels: ["A", "B", "C"] },
  { id: 2, name: "Invented one column", column_labels: ["Only"] },
  { id: 3, name: "Invented no columns", column_labels: [] as string[] },
];

export type AmountsCase = {
  id: number;
  profile_id: number;
  before: unknown[];
  after: unknown[];
  /** Only a backup can hold it (the column is NOT NULL JSON text). */
  backupOnly?: true;
};

export const ITEMS: AmountsCase[] = [
  // Already whole: untouched.
  { id: 1, profile_id: 1, before: [100, 50, 25], after: [100, 50, 25] },
  // Short: padded with 0.
  { id: 2, profile_id: 1, before: [100], after: [100, 0, 0] },
  { id: 3, profile_id: 1, before: [], after: [0, 0, 0] },
  // A null hole: 0, as every reader read it.
  { id: 4, profile_id: 1, before: [10, null, 30], after: [10, 0, 30] },
  { id: 5, profile_id: 1, before: [null], after: [0, 0, 0] },
  // Longer than the columns: never truncated.
  { id: 6, profile_id: 2, before: [7, 8, 9], after: [7, 8, 9] },
  // A zero is an amount, never a gap.
  { id: 7, profile_id: 2, before: [0], after: [0] },
  // No columns: nothing to pad.
  { id: 8, profile_id: 3, before: [], after: [] },
];

export type StoredItem = { profile_id: number; amounts: unknown[] };

/** The items as budget.ts read them before the tag: each column of the
 *  profile as `amounts[col] ?? 0` (frozen here; the reader now throws). */
export function asReadBeforeTag(items: readonly StoredItem[]): StoredItem[] {
  return items.map((i) => {
    const columns =
      PROFILES.find((p) => p.id === i.profile_id)?.column_labels.length ?? 0;
    const length = Math.max(columns, i.amounts.length);
    return {
      ...i,
      amounts: Array.from({ length }, (_, col) => i.amounts[col] ?? 0),
    };
  });
}

/** Each column's amount for each item, through the budget calculator's
 *  per-column totals and the annual total, as the budget page reads them. */
export function reads(
  items: readonly { profile_id: number; amounts: unknown[] }[],
) {
  return PROFILES.map((p) => {
    const own = items
      .filter((i) => i.profile_id === p.id)
      .map((i, n) => ({
        category: "Invented",
        label: `Item ${n}`,
        amounts: i.amounts as number[],
        isEssential: n % 2 === 0,
      }));
    return p.column_labels.map((_, col) => {
      const r = calculateBudget({
        items: own,
        columnLabels: p.column_labels,
        selectedColumn: col,
        asOfDate: new Date("2026-01-01"),
      });
      return {
        total: r.totalMonthly,
        essential: r.essentialTotal,
        items: r.categories.flatMap((c) => c.items.map((i) => i.amount)),
        annual: computeBudgetAnnualTotal(own, col, null),
      };
    });
  });
}
