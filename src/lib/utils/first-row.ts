/**
 * The first row of a result, or `undefined` when there are none:
 * `await db.select().from(t).where(…).then(firstRow)`. For a read that must
 * find exactly one row, check the result and throw at the call site.
 */
export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}
