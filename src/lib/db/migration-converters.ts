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

export type DataConverter = {
  /** The tables it reads; one that doesn't exist reads as absent. */
  readonly tables: readonly string[];
  /** Before the tag's SQL (it drops what the converter reads) or after it
   *  (it adds what the converter writes). */
  readonly runs: "beforeSql" | "afterSql";
  /** Idempotent: a no-op once its source is gone. */
  readonly convert: (tables: ConverterTables) => {
    readonly updates: readonly RowUpdate[];
    readonly notes: readonly string[];
  };
};

/** Migration tag → its converter. */
export const MIGRATION_CONVERTERS: Readonly<Record<string, DataConverter>> = {};

type Phase = DataConverter["runs"];

function converterFor(
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): DataConverter | null {
  const c = Object.hasOwn(converters, tag) ? converters[tag] : undefined;
  return c && c.runs === phase ? c : null;
}

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A value as a statement parameter: objects and arrays as JSON text. */
function param(value: unknown): unknown {
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value;
}

function updateSql(u: RowUpdate, placeholder: (i: number) => string) {
  const cols = Object.keys(u.set);
  const sets = cols.map((c, i) => `${quoted(c)} = ${placeholder(i + 1)}`);
  return {
    sql: `UPDATE ${quoted(u.table)} SET ${sets.join(", ")} WHERE "id" = ${placeholder(cols.length + 1)}`,
    params: [...cols.map((c) => param(u.set[c])), u.id],
  };
}

type PgClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Run `tag`'s converter for `phase` on PostgreSQL, inside the caller's
 *  transaction. Returns its notes for the caller to log. */
export async function runConverterPg(
  client: PgClient,
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): Promise<readonly string[]> {
  const c = converterFor(converters, tag, phase);
  if (!c) return [];
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
    const { sql, params } = updateSql(u, (i) => `$${i}`);
    await client.query(sql, params);
  }
  return result.notes;
}

type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
};

/** The SQLite twin of runConverterPg (synchronous, so it runs inside a
 *  better-sqlite3 transaction). */
export function runConverterSqlite(
  sqlite: SqliteDb,
  converters: Readonly<Record<string, DataConverter>>,
  tag: string,
  phase: Phase,
): readonly string[] {
  const c = converterFor(converters, tag, phase);
  if (!c) return [];
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
    const { sql, params } = updateSql(u, () => "?");
    sqlite.prepare(sql).run(...params);
  }
  return result.notes;
}
