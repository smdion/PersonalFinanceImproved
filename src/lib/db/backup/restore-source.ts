/** A backup's or a version's tables brought to the current schema as their
 *  source wrote them: the converters read a jsonb string scalar from a
 *  PostgreSQL source as JSON text, as the live migration does (selectPg). */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema-pg";
import { isRow } from "../migrate/converter-rows";
import { transformBackupToCurrentSchema } from "./backup-transforms";

/** Every jsonb column, by table. */
const JSONB_COLUMNS = new Map(
  Object.values<unknown>(schema)
    .filter((t) => is(t, PgTable))
    .map((t) => {
      const table = getTableConfig(t);
      const columns = table.columns
        .filter((c) => c.getSQLType() === "jsonb")
        .map((c) => c.name);
      return [table.name, columns] as const;
    })
    .filter(([, columns]) => columns.length > 0),
);

/** Each string scalar in a jsonb column, in place, by `as`. */
function eachStringScalar(
  tables: Record<string, unknown[]>,
  as: (value: string, table: string, column: string) => string,
) {
  for (const [table, columns] of JSONB_COLUMNS)
    for (const row of tables[table] ?? []) {
      if (!isRow(row)) continue;
      for (const column of columns) {
        const value = row[column];
        if (typeof value === "string") row[column] = as(value, table, column);
      }
    }
}

/** transformBackupToCurrentSchema for a source dialect: a PostgreSQL
 *  source's string scalars are JSON text while the steps run, and any one
 *  no converter rewrote is its string again after. */
export function transformFromSource(
  tables: Record<string, unknown[]>,
  versions: { from: string; to: string },
  sourceDialect: "postgres" | "sqlite" | undefined,
): ReturnType<typeof transformBackupToCurrentSchema> {
  // A backup that names no dialect (a SQLite export, whose JSON is text)
  // is read as the converters always read it.
  if (sourceDialect !== "postgres")
    return transformBackupToCurrentSchema(tables, versions.from, versions.to);
  const input: Record<string, unknown[]> = {};
  for (const [table, rows] of Object.entries(tables))
    input[table] = rows.map((r) =>
      typeof r === "object" && r !== null ? { ...r } : r,
    );
  const wrapped = new Set<string>();
  eachStringScalar(input, (value, table, column) => {
    const text = JSON.stringify(value);
    wrapped.add(`${table}.${column}\u0000${text}`);
    return text;
  });
  const result = transformBackupToCurrentSchema(
    input,
    versions.from,
    versions.to,
  );
  eachStringScalar(result.tables, (value, table, column) => {
    if (!wrapped.has(`${table}.${column}\u0000${value}`)) return value;
    const original: unknown = JSON.parse(value);
    return typeof original === "string" ? original : value;
  });
  return result;
}
