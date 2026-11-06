/** Per-tag data converters (DESIGN § Data-converting migrations): one copy
 *  serves the live migration (db-migrate.ts: pending loop and both squash
 *  replays, in the migration's transaction) and the restore step. */

/** A table's rows as read: snake_case keys, JSON as object or text. */
export type ConverterTables = Record<string, readonly unknown[] | undefined>;

/** One row's new column values, keyed by the row's `id`. */
export type RowUpdate = {
  readonly table: string;
  readonly id: number;
  readonly set: Readonly<Record<string, unknown>>;
};

export type ConverterResult = {
  readonly updates: readonly RowUpdate[];
  readonly notes: readonly string[];
};

export type DataConverter = {
  /** The tables it reads; one that doesn't exist reads as absent. */
  readonly tables: readonly string[];
  /** Before the tag's SQL (it drops what the converter reads) or after it
   *  (it adds what the converter writes). */
  readonly runs: "beforeSql" | "afterSql";
  /** Idempotent by storage: a replay reruns it, so it writes only where its
   *  new column or key is empty, never deciding by the value it reads (0.5
   *  is both a whole percent and a fraction). */
  readonly convert: (tables: ConverterTables) => ConverterResult;
};

/** Migration tag → its converter. */
export const MIGRATION_CONVERTERS: Readonly<Record<string, DataConverter>> = {};

type Phase = DataConverter["runs"];

/** What one converter run did, for its one log line. */
export type ConversionRun = {
  readonly updates: number;
  readonly notes: readonly string[];
};

function converterFor(
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): DataConverter | null {
  const c = Object.hasOwn(converters, tag) ? converters[tag] : undefined;
  return c && c.runs === phase ? c : null;
}

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Null, text, a finite number, a boolean, or a plain object or array of
 *  them (a JSON column), at any depth. */
function writable(value: unknown): boolean {
  if (value === null || typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every(writable);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(writable);
}

/** Anything else (undefined, NaN, a Date) is a converter bug: it stops the
 *  migration rather than reach the database as something else. */
function checked(u: RowUpdate, column: string): unknown {
  const value = u.set[column];
  if (!writable(value))
    throw new Error(
      `Converter update ${u.table} id ${u.id}: ${column} can't be written (${String(value)})`,
    );
  return value;
}

/** A value as a statement parameter: objects and arrays as JSON text, a
 *  boolean as 1/0 on SQLite (better-sqlite3 binds no booleans). */
function param(u: RowUpdate, column: string, sqlite: boolean): unknown {
  const value = checked(u, column);
  if (typeof value === "boolean" && sqlite) return value ? 1 : 0;
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value;
}

function updateSql(
  u: RowUpdate,
  placeholder: (i: number) => string,
  sqlite: boolean,
) {
  const cols = Object.keys(u.set);
  if (cols.length === 0 || !Number.isSafeInteger(u.id))
    throw new Error(
      `Converter update ${u.table} id ${String(u.id)} sets nothing or names no row`,
    );
  const sets = cols.map((c, i) => `${quoted(c)} = ${placeholder(i + 1)}`);
  return {
    sql: `UPDATE ${quoted(u.table)} SET ${sets.join(", ")} WHERE "id" = ${placeholder(cols.length + 1)}`,
    params: [...cols.map((c) => param(u, c, sqlite)), u.id],
  };
}

/** Each update names exactly one row. */
function assertOneRow(u: RowUpdate, changed: number | null | undefined) {
  if (changed !== 1)
    throw new Error(
      `Converter update ${u.table} id ${u.id} changed ${String(changed)} rows, not 1`,
    );
}

type PgClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

/** Run `tag`'s converter for `phase` on PostgreSQL, inside the caller's
 *  transaction. Null when it has none; else what it did, for the caller to
 *  log in one line. */
export async function runConverterPg(
  client: PgClient,
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): Promise<ConversionRun | null> {
  const c = converterFor(converters, tag, phase);
  if (!c) return null;
  const tables: Record<string, unknown[] | undefined> = {};
  for (const table of c.tables) {
    const { rows } = await client.query(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [table],
    );
    if (rows[0]?.["present"])
      tables[table] = (
        await client.query(`SELECT * FROM ${quoted(table)}`)
      ).rows;
  }
  const result = c.convert(tables);
  for (const u of result.updates) {
    const { sql, params } = updateSql(u, (i) => `$${i}`, false);
    assertOneRow(u, (await client.query(sql, params)).rowCount);
  }
  return { updates: result.updates.length, notes: result.notes };
}

type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
};

/** The SQLite twin of runConverterPg (synchronous, so it runs inside a
 *  better-sqlite3 transaction). */
export function runConverterSqlite(
  sqlite: SqliteDb,
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): ConversionRun | null {
  const c = converterFor(converters, tag, phase);
  if (!c) return null;
  const tables: Record<string, unknown[] | undefined> = {};
  for (const table of c.tables)
    if (
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table)
    )
      tables[table] = sqlite.prepare(`SELECT * FROM ${quoted(table)}`).all();
  const result = c.convert(tables);
  for (const u of result.updates) {
    const { sql, params } = updateSql(u, () => "?", true);
    assertOneRow(u, sqlite.prepare(sql).run(...params).changes);
  }
  return { updates: result.updates.length, notes: result.notes };
}
