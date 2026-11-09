/**
 * The replay-twice proof any converter's test calls (DESIGN § Data-
 * converting migrations): run again over its own output, a tag's converters
 * write nothing and every row stays byte-identical. One helper per path the
 * converters run on: a backup's tables (the restore step), a SQLite
 * database, and PostgreSQL inside a test's own connection.
 */
import { expect } from "vitest";
import type Database from "better-sqlite3";
import type pg from "pg";
import {
  convertBackup,
  runConverterPg,
  runConverterSqlite,
  type ConversionRun,
  type TagConverters,
} from "@/lib/db/migrate/migration-converters";

const TAG = "replay_under_test";

/** A run that wrote nothing (its notes may still count zeros). */
function expectNoWrites(run: ConversionRun | null) {
  expect(run?.updates ?? 0).toBe(0);
  expect(run?.inserts).toBeUndefined();
  expect(run?.deletes).toBeUndefined();
}

/** Each table's rows as sorted JSON text: equal text, byte-identical rows. */
const sortedRows = (tables: Record<string, readonly unknown[]>) =>
  Object.fromEntries(
    Object.entries(tables).map(([t, rows]) => [
      t,
      rows.map((r) => JSON.stringify(r)).sort(),
    ]),
  );

/** The restore path: converts `tables` in place, then twice more over its
 *  own output. Returns the converted tables. */
export function expectRestoreReplaySafe(
  converters: TagConverters,
  tables: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const registry = { [TAG]: converters };
  convertBackup(tables, registry, TAG);
  const once = sortedRows(tables);
  for (let pass = 0; pass < 2; pass++) {
    expectNoWrites(convertBackup(tables, registry, TAG));
    expect(sortedRows(tables)).toEqual(once);
  }
  return tables;
}

function sqliteTables(db: Database.Database) {
  const names = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
  return Object.fromEntries(
    names.map((n) => [
      n,
      db.prepare(`SELECT * FROM "${n.replace(/"/g, '""')}"`).all(),
    ]),
  );
}

/** A SQLite database: each phase's converters run, then twice more; every
 *  table of the database must stay byte-identical. */
export function expectSqliteReplaySafe(
  db: Database.Database,
  converters: TagConverters,
): void {
  const registry = { [TAG]: converters };
  const run = () =>
    (["beforeSql", "afterSql"] as const).map((phase) =>
      runConverterSqlite(db, registry, TAG, phase),
    );
  run();
  const once = sortedRows(sqliteTables(db));
  for (let pass = 0; pass < 2; pass++) {
    for (const r of run()) expectNoWrites(r);
    expect(sortedRows(sqliteTables(db))).toEqual(once);
  }
}

async function pgTables(client: pg.Client) {
  const { rows } = await client.query<{ name: string }>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of rows)
    out[name] = (
      await client.query(`SELECT * FROM "${name.replace(/"/g, '""')}"`)
    ).rows;
  return out;
}

/** The PostgreSQL twin of expectSqliteReplaySafe, on the public schema. */
export async function expectPgReplaySafe(
  client: pg.Client,
  converters: TagConverters,
): Promise<void> {
  const registry = { [TAG]: converters };
  const run = async () => [
    await runConverterPg(client, registry, TAG, "beforeSql"),
    await runConverterPg(client, registry, TAG, "afterSql"),
  ];
  await run();
  const once = sortedRows(await pgTables(client));
  for (let pass = 0; pass < 2; pass++) {
    for (const r of await run()) expectNoWrites(r);
    expect(sortedRows(await pgTables(client))).toEqual(once);
  }
}
