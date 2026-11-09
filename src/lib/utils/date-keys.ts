/**
 * Pure month-key builders shared by server and client. Use `monthKey`/
 * `currentMonthKey` instead of hand-rolling the format (RULES.md's Single
 * Computation Path rule).
 */

/**
 * YNAB's native month key, `YYYY-MM-01`: the budget-api cache key and any month's
 * stable identity (Actual's `YYYY-MM` is converted in toActualMonthId).
 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** `monthKey` for "right now"; takes an explicit `now` (callers already have
 *  one) so it stays deterministic in tests. */
export function currentMonthKey(now: Date): string {
  return monthKey(now);
}
