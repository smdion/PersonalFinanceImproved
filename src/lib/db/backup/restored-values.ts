/**
 * Writing a version's or backup's rows back: which columns hold JSON, and a
 * restored row's values as SQL. Rows hold each value as read (node-postgres
 * parsed a jsonb value; SQLite's JSON columns are text).
 */
import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema-pg";
import { queryRaw } from "../compat";
import { isPostgres } from "../dialect";
import { encodeJsonbForPgImport } from "./jsonb-import";
import { parsedJson } from "../migrate/converter-rows";

type ColumnRows = { column_name: string; is_nullable: string }[];

/** A JSON column as a restore writes it: NOT NULL or not, and as jsonb
 *  (PostgreSQL) or as JSON text (SQLite, from a parsed PostgreSQL row). */
export type JsonbColumn = { notNull: boolean; asText?: true };

/** Every JSON column, by table, from the schema (as SQLite's JSON text). */
const SCHEMA_JSON_COLUMNS = new Map(
  Object.values<unknown>(schema)
    .filter((t) => is(t, PgTable))
    .map((t) => {
      const table = getTableConfig(t);
      const columns = table.columns
        .filter((c) => c.getSQLType() === "jsonb")
        .map((c) => [c.name, { notNull: c.notNull, asText: true }] as const);
      return [table.name, new Map<string, JsonbColumn>(columns)] as const;
    }),
);

/** A table's JSON columns as `sourceDialect`'s rows are written here: jsonb
 *  on PostgreSQL; on SQLite, JSON text for a PostgreSQL source's parsed
 *  values, none for SQLite rows (already JSON text, written as stored). */
export async function jsonColumnsFor(
  tx: Parameters<typeof queryRaw>[0],
  tableName: string,
  sourceDialect: "postgres" | "sqlite" | undefined,
): Promise<Map<string, JsonbColumn>> {
  if (isPostgres()) return jsonbColumnsInTx(tx, tableName);
  if (sourceDialect !== "postgres") return new Map();
  return SCHEMA_JSON_COLUMNS.get(tableName) ?? new Map();
}

/** A table's jsonb columns, read from information_schema by `run` on the
 *  caller's own connection. */
export async function jsonbColumns(
  run: (query: SQL) => Promise<ColumnRows>,
  tableName: string,
): Promise<Map<string, JsonbColumn>> {
  const rows = await run(
    sql`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName} AND data_type = 'jsonb'`,
  );
  return new Map(
    rows.map((r) => [r.column_name, { notNull: r.is_nullable === "NO" }]),
  );
}

/** A table's jsonb columns, read in the caller's transaction. */
function jsonbColumnsInTx(
  tx: Parameters<typeof queryRaw>[0],
  tableName: string,
) {
  return jsonbColumns((q) => queryRaw<ColumnRows[number]>(tx, q), tableName);
}

/** Each table's jsonb columns, read on a pool client's own connection (an
 *  import's transaction). */
export async function jsonbColumnsOnClient(
  client: {
    query: (text: string, params: unknown[]) => Promise<{ rows: ColumnRows }>;
  },
  tables: readonly string[],
): Promise<Map<string, Map<string, JsonbColumn>>> {
  const onClient = async (q: SQL) => {
    const { sql: text, params } = new PgDialect().sqlToQuery(q);
    return (await client.query(text, params)).rows;
  };
  const byTable = new Map<string, Map<string, JsonbColumn>>();
  for (const table of tables)
    byTable.set(table, await jsonbColumns(onClient, table));
  return byTable;
}

/** A missing JSON value as SQL: a NOT NULL column's is JSON null (a
 *  PostgreSQL row reads a stored JSON null as null), any other's NULL. */
export function missingJsonb(column: JsonbColumn | undefined): string {
  if (!column?.notNull) return "NULL";
  return column.asText ? "'null'" : "'null'::jsonb";
}

/** One value of a restore: a JSON column's as JSON text (cast to jsonb on
 *  PostgreSQL), whatever its type (a string stays a JSON string, false stays
 *  false; see missingJsonb for null); any other column's as before. */
export function restoredValue(
  val: unknown,
  jsonb: JsonbColumn | undefined,
): SQL {
  if (val === null || val === undefined) return sql.raw(missingJsonb(jsonb));
  if (jsonb?.asText) return sql`${JSON.stringify(val)}`;
  if (jsonb) return sql`${encodeJsonbForPgImport(val, "postgres")}::jsonb`;
  if (typeof val === "boolean") return val ? sql`TRUE` : sql`FALSE`;
  if (typeof val === "object") {
    const jsonStr = JSON.stringify(val);
    return isPostgres() ? sql`${jsonStr}::jsonb` : sql`${jsonStr}`;
  }
  return sql`${val}`;
}

/** Rows with each of `json`'s columns as JSON text, as a SQLite export holds
 *  them (null stays null). */
export function rowsAsJsonText(
  rows: Record<string, unknown>[],
  json: { has: (column: string) => boolean },
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([c, v]) => [
        c,
        json.has(c) && v != null ? JSON.stringify(v) : v,
      ]),
    ),
  );
}

/** Rows read here in the form a backup from `sourceDialect` holds them, so
 *  the two can be written together: on PostgreSQL a SQLite source's JSON as
 *  text, on SQLite a PostgreSQL source's JSON parsed (jsonColumnsFor). */
export async function rowsInSourceForm(
  tx: Parameters<typeof queryRaw>[0],
  tableName: string,
  rows: Record<string, unknown>[],
  sourceDialect: "postgres" | "sqlite" | undefined,
): Promise<Record<string, unknown>[]> {
  const crosses = isPostgres()
    ? sourceDialect === "sqlite"
    : sourceDialect === "postgres";
  if (!crosses) return rows;
  const json = await jsonColumnsFor(tx, tableName, sourceDialect);
  if (isPostgres()) return rowsAsJsonText(rows, json);
  // Text that isn't JSON is its own value: a string an older import stored
  // unquoted (docs/FALLBACKS.md), written back quoted.
  const asValue = (v: string) => {
    const value = parsedJson(v); // JSON null stays null; non-JSON is undefined
    return value === undefined ? v : value;
  };
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([c, v]): [string, unknown] => [
        c,
        json.has(c) && typeof v === "string" ? asValue(v) : v,
      ]),
    ),
  );
}
