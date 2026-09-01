/**
 * Shared "what month is this date in" key builders. Framework-agnostic pure
 * functions (no I/O, no server-only dependency) — usable from both server
 * code (budget-api cache keys, sync routers) and anything else that needs
 * the same month-key identity, e.g. paycheck override matching, savings
 * allocation-override UI.
 *
 * This exact `YYYY-MM-01` computation had drifted into eleven independent
 * hand-rolled copies before being unified here — RULES.md's Single
 * Computation Path rule:
 *   - "current month" (today's date): `budget.ts` x2, `sync/core.ts` x2,
 *     `budget-api/cache.ts`'s own `refreshCategoryCache`,
 *     `extra-paycheck-materializer.ts`.
 *   - arbitrary date (a specific month being labeled/looked up, not
 *     necessarily today): `savings-trajectory-table.tsx`,
 *     `fund-overrides-summary.tsx` (x3), `month-override-modal.tsx`.
 * Callers needing "this cache row's key" or "this month's label" MUST use
 * `monthKey`/`currentMonthKey`, not hand-roll the format again.
 */

/**
 * YNAB's own native month format, `YYYY-MM-01` (a full ISO date, first of
 * the month) — used as the `months/${...}` budget-api cache key and
 * anywhere else a specific month needs a stable string identity. See
 * `toActualMonthId` in `actual-client.ts` for why Actual's wrapper needs
 * the shorter `YYYY-MM` instead, converted at the point of use there.
 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * `monthKey` for "right now" — the common case (cache keys, "this
 * month's" lookups). Takes an explicit `now` rather than calling
 * `new Date()` internally: every real caller already has its own `now`
 * in scope (often reused for other computations in the same request),
 * and an explicit param keeps this deterministically testable.
 */
export function currentMonthKey(now: Date): string {
  return monthKey(now);
}
