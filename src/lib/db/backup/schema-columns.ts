/** The schema's columns of one SQL type, by table: what a restore converts by column type. */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import * as schema from "../schema-pg";

/** Each table with a column whose SQL type passes `test`, and those columns. */
export function schemaColumnsOfType(
  test: (sqlType: string) => boolean,
): Map<string, PgColumn[]> {
  const byTable = new Map<string, PgColumn[]>();
  for (const t of Object.values<unknown>(schema)) {
    if (!is(t, PgTable)) continue;
    const table = getTableConfig(t);
    const columns = table.columns.filter((c) => test(c.getSQLType()));
    if (columns.length > 0) byTable.set(table.name, columns);
  }
  return byTable;
}
