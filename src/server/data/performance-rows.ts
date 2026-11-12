import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

// A year's rows in one order on either database: SQLite answered ORDER BY
// year from the unique index, PostgreSQL in its scan order. Text compares
// by code unit (SQLite's BINARY); PostgreSQL's follows its locale.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** No owner (a joint account's row) first, as SQLite sorts NULL. */
const byOwner = (a: number | null, b: number | null) =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b;

/** Every annual_performance row, by year, then category. */
export async function getAnnualPerformance(db: DbOrTx) {
  const rows = await db.select().from(schema.annualPerformance);
  return rows.sort((a, b) => a.year - b.year || byText(a.category, b.category));
}

/** Every account_performance row, by year, institution, label, owner, then
 *  id. */
export async function getAccountPerformance(db: DbOrTx) {
  const rows = await db.select().from(schema.accountPerformance);
  return rows.sort(
    (a, b) =>
      a.year - b.year ||
      byText(a.institution, b.institution) ||
      byText(a.accountLabel, b.accountLabel) ||
      byOwner(a.ownerPersonId, b.ownerPersonId) ||
      a.id - b.id,
  );
}
