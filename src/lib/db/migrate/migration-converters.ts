/** Per-tag data converters (DESIGN § Data-converting migrations): one copy
 *  serves the live migration (db-migrate.ts: pending loop and both squash
 *  replays, in the migration's transaction) and the restore step. */

import { MATCH_RATE_CONVERTER, MATCH_RATE_TAG } from "./v0102-match-rate";
import { MATCH_VALUE_CONVERTER, MATCH_VALUE_TAG } from "./v0102-match-value";

/** A table's rows as read: snake_case keys, JSON as object or text. */
export type ConverterTables = Record<string, readonly unknown[] | undefined>;

/** One row's new column values, keyed by the row's `id`. */
export type RowUpdate = {
  readonly table: string;
  readonly id: number;
  readonly set: Readonly<Record<string, unknown>>;
};

/** A new row's column values; the database numbers it. */
export type RowInsert = {
  readonly table: string;
  readonly row: Readonly<Record<string, unknown>>;
};

/** The row with this `id` goes (its children first: no cascade fires). */
export type RowDelete = { readonly table: string; readonly id: number };

/** Applied as deletes, then updates, then inserts, each in list order and
 *  each naming exactly one row. */
export type ConverterResult = {
  readonly updates: readonly RowUpdate[];
  readonly inserts?: readonly RowInsert[];
  readonly deletes?: readonly RowDelete[];
  readonly notes: readonly string[];
};

export type DataConverter = {
  /** The tables it reads; one that doesn't exist reads as absent. */
  readonly tables: readonly string[];
  /** Before the tag's SQL (it drops what the converter reads) or after it
   *  (it adds what the converter writes). */
  readonly runs: "beforeSql" | "afterSql";
  /** Idempotent: gates on structure or a closed set, rewrites in place only
   *  as a projection, never infers "done" or a unit from a magnitude (DESIGN
   *  § Data-converting migrations: "What a converter may decide by"). */
  readonly convert: (tables: ConverterTables) => ConverterResult;
};

/** A tag's converter, or several that run in order, each over a fresh read
 *  of its tables. */
export type TagConverters = DataConverter | readonly DataConverter[];

/** Migration tag → its converters, in journal order: the restore step runs
 *  every one in this order. A tag stays after a squash drops it from the
 *  journal, so a backup from before the squash still converts. */
export const MIGRATION_CONVERTERS: Readonly<Record<string, TagConverters>> = {
  [MATCH_RATE_TAG]: MATCH_RATE_CONVERTER,
  [MATCH_VALUE_TAG]: MATCH_VALUE_CONVERTER,
};

type Phase = DataConverter["runs"];

/** What one tag's converters did at one phase, for its one log line;
 *  `inserts` and `deletes` only when there were any. */
export type ConversionRun = {
  readonly updates: number;
  readonly inserts?: number;
  readonly deletes?: number;
  readonly notes: readonly string[];
};

/** `tag`'s converters, in order. */
export function tagConverters(
  tag: string,
  converters: Readonly<Record<string, TagConverters>> = MIGRATION_CONVERTERS,
): readonly DataConverter[] {
  const entry = Object.hasOwn(converters, tag) ? converters[tag] : undefined;
  if (!entry) return [];
  return "convert" in entry ? [entry] : entry;
}

const convertersAt = (
  converters: Readonly<Record<string, TagConverters>>,
  tag: string,
  phase: Phase | "restore",
) =>
  tagConverters(tag, converters).filter(
    (c) => phase === "restore" || c.runs === phase,
  );

/** The runs of one tag's converters as its one log line. */
function tally(results: readonly ConverterResult[]): ConversionRun {
  const count = (
    pick: (r: ConverterResult) => readonly unknown[] | undefined,
  ) => results.reduce((n, r) => n + (pick(r)?.length ?? 0), 0);
  const inserts = count((r) => r.inserts);
  const deletes = count((r) => r.deletes);
  return {
    updates: count((r) => r.updates),
    ...(inserts > 0 ? { inserts } : {}),
    ...(deletes > 0 ? { deletes } : {}),
    notes: results.flatMap((r) => r.notes),
  };
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

/** What a write names in an error: "Converter update t id 3". */
const updateLabel = (u: RowUpdate) => `Converter update ${u.table} id ${u.id}`;
const insertLabel = (i: RowInsert) => `Converter insert into ${i.table}`;
const deleteLabel = (d: RowDelete) => `Converter delete ${d.table} id ${d.id}`;

/** Anything else (undefined, NaN, a Date) is a converter bug: it stops the
 *  migration rather than reach the database as something else. */
function checked(label: string, column: string, value: unknown): unknown {
  if (!writable(value))
    throw new Error(`${label}: ${column} can't be written (${String(value)})`);
  return value;
}

/** A value as a statement parameter: objects and arrays as JSON text, a
 *  boolean as 1/0 on SQLite (better-sqlite3 binds no booleans). */
function param(
  label: string,
  column: string,
  raw: unknown,
  sqlite: boolean,
): unknown {
  const value = checked(label, column, raw);
  if (typeof value === "boolean" && sqlite) return value ? 1 : 0;
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value;
}

type Statement = { label: string; sql: string; params: unknown[] };
type Placeholder = (i: number) => string;

function updateSql(u: RowUpdate, at: Placeholder, sqlite: boolean): Statement {
  const label = updateLabel(u);
  const cols = Object.keys(u.set);
  if (cols.length === 0 || !Number.isSafeInteger(u.id))
    throw new Error(
      `Converter update ${u.table} id ${String(u.id)} sets nothing or names no row`,
    );
  const sets = cols.map((c, i) => `${quoted(c)} = ${at(i + 1)}`);
  return {
    label,
    sql: `UPDATE ${quoted(u.table)} SET ${sets.join(", ")} WHERE "id" = ${at(cols.length + 1)}`,
    params: [...cols.map((c) => param(label, c, u.set[c], sqlite)), u.id],
  };
}

/** The database numbers the row, so it never names an `id`. */
function insertSql(i: RowInsert, at: Placeholder, sqlite: boolean): Statement {
  const label = insertLabel(i);
  const cols = Object.keys(i.row);
  if (cols.length === 0 || cols.includes("id"))
    throw new Error(`${label} sets nothing or names an id`);
  return {
    label,
    sql: `INSERT INTO ${quoted(i.table)} (${cols.map(quoted).join(", ")}) VALUES (${cols.map((_, n) => at(n + 1)).join(", ")})`,
    params: cols.map((c) => param(label, c, i.row[c], sqlite)),
  };
}

function deleteSql(d: RowDelete, at: Placeholder): Statement {
  const label = deleteLabel(d);
  if (!Number.isSafeInteger(d.id))
    throw new Error(
      `Converter delete ${d.table} id ${String(d.id)} names no row`,
    );
  return {
    label,
    sql: `DELETE FROM ${quoted(d.table)} WHERE "id" = ${at(1)}`,
    params: [d.id],
  };
}

/** Every statement of a result, in the order it applies them; each is
 *  built (and so checked) before the first one runs. */
function statements(
  r: ConverterResult,
  at: Placeholder,
  sqlite: boolean,
): Statement[] {
  return [
    ...(r.deletes ?? []).map((d) => deleteSql(d, at)),
    ...r.updates.map((u) => updateSql(u, at, sqlite)),
    ...(r.inserts ?? []).map((i) => insertSql(i, at, sqlite)),
  ];
}

/** Each write names exactly one row. */
function assertOneRow(label: string, changed: number | null | undefined) {
  if (changed !== 1)
    throw new Error(`${label} changed ${String(changed)} rows, not 1`);
}

type PgClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{
    rows: Record<string, unknown>[];
    rowCount?: number | null;
    fields?: readonly { name: string; dataTypeID: number }[];
  }>;
};

/** json and jsonb type ids. */
const PG_JSON_TYPES = new Set([114, 3802]);

/** A table's rows as a converter reads them: a json value that node-pg
 *  gives as a string (a JSON string scalar, e.g. a double-encoded column)
 *  becomes its JSON text, so it can't pass for SQLite's object text. */
async function selectPg(client: PgClient, table: string) {
  const { rows, fields } = await client.query(`SELECT * FROM ${quoted(table)}`);
  const json = (fields ?? []).filter((f) => PG_JSON_TYPES.has(f.dataTypeID));
  return rows.map((row) => {
    const out = { ...row };
    for (const { name } of json)
      if (typeof out[name] === "string") out[name] = JSON.stringify(out[name]);
    return out;
  });
}

/** Run `tag`'s converters for `phase` on PostgreSQL, inside the caller's
 *  transaction. Null when it has none; else what they did, for the caller
 *  to log in one line. */
export async function runConverterPg(
  client: PgClient,
  converters: Readonly<Record<string, TagConverters>>,
  tag: string,
  phase: Phase,
): Promise<ConversionRun | null> {
  const list = convertersAt(converters, tag, phase);
  if (list.length === 0) return null;
  const results: ConverterResult[] = [];
  for (const c of list) {
    const tables: Record<string, unknown[] | undefined> = {};
    for (const table of c.tables) {
      const { rows } = await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [table],
      );
      if (rows[0]?.["present"]) tables[table] = await selectPg(client, table);
    }
    const result = c.convert(tables);
    for (const s of statements(result, (i) => `$${i}`, false))
      assertOneRow(s.label, (await client.query(s.sql, s.params)).rowCount);
    results.push(result);
  }
  return tally(results);
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
  converters: Readonly<Record<string, TagConverters>>,
  tag: string,
  phase: Phase,
): ConversionRun | null {
  const list = convertersAt(converters, tag, phase);
  if (list.length === 0) return null;
  const results = list.map((c) => {
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
    for (const s of statements(result, () => "?", true))
      assertOneRow(s.label, sqlite.prepare(s.sql).run(...s.params).changes);
    return result;
  });
  return tally(results);
}

type BackupRow = Record<string, unknown>;
const isBackupRow = (r: unknown): r is BackupRow =>
  typeof r === "object" && r !== null;

/** A backup table's rows with this id (an update or delete needs one). */
function rowsWithId(
  tables: Record<string, unknown[]>,
  table: string,
  id: number,
) {
  return (tables[table] ?? []).filter(
    (r): r is BackupRow => isBackupRow(r) && r["id"] === id,
  );
}

/** A converter's result applied to a backup's rows in place (a JSON column
 *  keeps the object); an inserted row takes the table's next id. */
function applyToBackup(tables: Record<string, unknown[]>, r: ConverterResult) {
  for (const d of r.deletes ?? []) {
    const rows = rowsWithId(tables, d.table, d.id);
    assertOneRow(deleteLabel(d), rows.length);
    const list = tables[d.table]!;
    list.splice(list.indexOf(rows[0]), 1);
  }
  for (const u of r.updates) {
    const rows = rowsWithId(tables, u.table, u.id);
    assertOneRow(updateLabel(u), rows.length);
    for (const column of Object.keys(u.set))
      rows[0]![column] = checked(updateLabel(u), column, u.set[column]);
  }
  for (const i of r.inserts ?? []) {
    insertSql(i, () => "?", false); // the same checks as the database's
    const list = (tables[i.table] ??= []);
    const last = list.reduce<number>((max, x) => {
      const id = isBackupRow(x) ? x["id"] : undefined;
      return typeof id === "number" && id > max ? id : max;
    }, 0);
    list.push({ ...i.row, id: last + 1 });
  }
}

/** The restore step: `tag`'s converters over a backup's tables, each one's
 *  result applied before the next one reads. */
export function convertBackup(
  tables: Record<string, unknown[]>,
  converters: Readonly<Record<string, TagConverters>>,
  tag: string,
): ConversionRun | null {
  const list = convertersAt(converters, tag, "restore");
  if (list.length === 0) return null;
  const results = list.map((c) => {
    const read: Record<string, unknown[] | undefined> = {};
    for (const table of c.tables) read[table] = tables[table];
    const result = c.convert(read);
    applyToBackup(tables, result);
    return result;
  });
  return tally(results);
}

/** The restore step, whatever the backup's version: every converter in
 *  registry (journal) order, each a no-op where its work is done. */
export function convertBackupInOrder(
  tables: Record<string, unknown[]>,
  converters: Readonly<Record<string, TagConverters>> = MIGRATION_CONVERTERS,
): { tag: string; run: ConversionRun }[] {
  const runs: { tag: string; run: ConversionRun }[] = [];
  for (const tag of Object.keys(converters)) {
    const run = convertBackup(tables, converters, tag);
    if (run) runs.push({ tag, run });
  }
  return runs;
}
