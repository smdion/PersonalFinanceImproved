/**
 * Writing a version's or backup's rows back on PostgreSQL: which columns are
 * jsonb, and a restored row's values as SQL. Rows hold each value as read
 * (node-postgres parsed a jsonb value; SQLite's JSON columns are text).
 */
import { sql, type SQL } from "drizzle-orm";
import { isPostgres } from "../dialect";
import { encodeJsonbForPgImport } from "./jsonb-import";

type ColumnRows = { column_name: string }[];

/** A table's jsonb columns, read from information_schema by `run` on the
 *  caller's own connection. */
export async function jsonbColumns(
  run: (query: SQL) => Promise<ColumnRows>,
  tableName: string,
): Promise<Set<string>> {
  const rows = await run(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName} AND data_type = 'jsonb'`,
  );
  return new Set(rows.map((r) => r.column_name));
}

/** One value of a version restore: a jsonb column's as JSON text cast to
 *  jsonb, whatever its type (a string stays a JSON string, false stays
 *  false); any other column's as before. */
export function restoredValue(val: unknown, jsonb: boolean): SQL {
  if (val === null || val === undefined) return sql`NULL`;
  if (jsonb) return sql`${encodeJsonbForPgImport(val, "postgres")}::jsonb`;
  if (typeof val === "boolean") return val ? sql`TRUE` : sql`FALSE`;
  if (typeof val === "object") {
    const jsonStr = JSON.stringify(val);
    return isPostgres() ? sql`${jsonStr}::jsonb` : sql`${jsonStr}`;
  }
  return sql`${val}`;
}
