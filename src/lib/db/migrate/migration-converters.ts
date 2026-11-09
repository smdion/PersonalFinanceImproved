/** Per-tag data converters (DESIGN § Data-converting migrations): one copy
 *  serves the live migration (db-migrate.ts: pending loop and both squash
 *  replays, in the migration's transaction) and the restore step. */

import type { ConverterContext } from "./converter-rows";
import { ENV_CONTEXT } from "./converter-refusal";
import {
  applyToBackup,
  assertOneRow,
  quoted,
  statements,
  type ConverterResult,
} from "./converter-writes";
import { MATCH_RATE_CONVERTER, MATCH_RATE_TAG } from "./v0102-match-rate";
import { MATCH_VALUE_CONVERTER, MATCH_VALUE_TAG } from "./v0102-match-value";

/** A table's rows as read: snake_case keys, JSON as object or text. */
export type ConverterTables = Record<string, readonly unknown[] | undefined>;

export type {
  ConverterResult,
  RowDelete,
  RowInsert,
  RowUpdate,
} from "./converter-writes";

export type DataConverter = {
  /** The tables it reads; one that doesn't exist reads as absent. */
  readonly tables: readonly string[];
  /** Before the tag's SQL (it drops what the converter reads) or after it
   *  (it adds what the converter writes). */
  readonly runs: "beforeSql" | "afterSql";
  /** Tables whose row count its writes may raise or lower: the only ones
   *  scripts/test-migration.sh lets change (besides reference tables). */
  readonly rowCounts?: {
    readonly grows?: readonly string[];
    readonly shrinks?: readonly string[];
  };
  /** Idempotent: gates on structure or a closed set, rewrites in place only
   *  as a projection, never infers "done" or a unit from a magnitude (DESIGN
   *  § Data-converting migrations: "What a converter may decide by"). */
  readonly convert: (
    tables: ConverterTables,
    context: ConverterContext,
  ) => ConverterResult;
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
/** date and timestamptz type ids (the schema has no zoneless timestamp). */
const PG_DATE = 1082;
const PG_TIMESTAMPTZ = 1184;

/** A date node-pg parsed at local midnight, as SQLite's "YYYY-MM-DD". */
const dateText = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");

/** A table's rows as a converter reads them: a json string scalar becomes
 *  its JSON text (it can't pass for SQLite's object text), a date its
 *  "YYYY-MM-DD" text and a timestamp ISO text, never a Date. */
async function selectPg(client: PgClient, table: string) {
  const { rows, fields = [] } = await client.query(
    `SELECT * FROM ${quoted(table)}`,
  );
  return rows.map((row) => {
    const out = { ...row };
    for (const { name, dataTypeID: type } of fields) {
      const v = out[name];
      if (PG_JSON_TYPES.has(type) && typeof v === "string")
        out[name] = JSON.stringify(v);
      else if (v instanceof Date && type === PG_DATE) out[name] = dateText(v);
      else if (v instanceof Date && type === PG_TIMESTAMPTZ)
        out[name] = v.toISOString();
    }
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
    const result = c.convert(tables, ENV_CONTEXT);
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
    const result = c.convert(tables, ENV_CONTEXT);
    for (const s of statements(result, () => "?", true))
      assertOneRow(s.label, sqlite.prepare(s.sql).run(...s.params).changes);
    return result;
  });
  return tally(results);
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
    const result = c.convert(read, ENV_CONTEXT);
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
