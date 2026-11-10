/**
 * The replay-twice proof any converter's test calls (DESIGN § Data-
 * converting migrations): run again over its own output, a tag's
 * converters write nothing, every row stays byte-identical and no note
 * quotes the fixture's text. One helper per path the converters run on (a
 * backup's tables, SQLite, PostgreSQL inside a test's own connection),
 * plus the whole registry replayed at the journal head, and the restore
 * step and SQLite giving the same rows for one fixture.
 */
import { expect } from "vitest";
import type Database from "better-sqlite3";
import type pg from "pg";
import {
  convertBackup,
  runConverterPg,
  runConverterSqlite,
  MIGRATION_CONVERTERS,
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

/** A fixture's stored text: every string cell (and string inside a JSON
 *  cell) of four characters or more, so a short code can't match by chance. */
function cellTexts(tables: Record<string, readonly unknown[]>): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (v.length >= 4) out.add(v);
      try {
        const parsed: unknown = JSON.parse(v);
        if (typeof parsed === "object") walk(parsed);
      } catch {
        // not JSON text
      }
    } else if (typeof v === "object" && v !== null)
      for (const x of Object.values(v)) walk(x);
  };
  for (const rows of Object.values(tables)) walk(rows);
  return [...out];
}

/** No note or refusal quotes the fixture's stored text: they name counts,
 *  ids and fields only. */
export function expectNoCellText(
  texts: readonly string[],
  tables: Record<string, readonly unknown[]>,
): void {
  const cells = cellTexts(tables);
  for (const text of texts)
    for (const cell of cells) expect(text).not.toContain(cell);
}

/** The restore path: converts `tables` in place, then twice more over its
 *  own output, no note quoting the fixture. Returns the converted tables. */
export function expectRestoreReplaySafe(
  converters: TagConverters,
  tables: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const registry = { [TAG]: converters };
  const fixture = structuredClone(tables);
  const notes = [...(convertBackup(tables, registry, TAG)?.notes ?? [])];
  const once = sortedRows(tables);
  for (let pass = 0; pass < 2; pass++) {
    const run = convertBackup(tables, registry, TAG);
    expectNoWrites(run);
    notes.push(...(run?.notes ?? []));
    expect(sortedRows(tables)).toEqual(once);
  }
  expectNoCellText(notes, fixture);
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

/** Every registered converter at the journal head, then again: the second
 *  pass writes nothing and leaves every row as the first pass left it. */
export function expectRegistryReplaySafe(
  db: Database.Database,
  converters: Readonly<Record<string, TagConverters>> = MIGRATION_CONVERTERS,
): void {
  const run = () =>
    Object.keys(converters).flatMap((tag) =>
      (["beforeSql", "afterSql"] as const).map((phase) =>
        runConverterSqlite(db, converters, tag, phase),
      ),
    );
  run();
  const once = sortedRows(sqliteTables(db));
  for (const r of run()) expectNoWrites(r);
  expect(sortedRows(sqliteTables(db))).toEqual(once);
}

/** A cell as both paths can compare it: JSON text parsed, numeric text and
 *  1/0 as numbers, true/false as 1/0. */
function comparable(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    if (v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    try {
      const parsed: unknown = JSON.parse(v);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // plain text
    }
  }
  return v;
}

const asParam = (v: unknown) =>
  typeof v === "boolean"
    ? Number(v)
    : typeof v === "object" && v !== null
      ? JSON.stringify(v)
      : v;

/** Each table's rows, ids aside, on the columns the restored rows hold (a
 *  column a row lacks reads NULL, as the restore writes it). */
function projected(rows: readonly unknown[], columns: readonly string[]) {
  return rows
    .map((r) =>
      JSON.stringify(
        Object.fromEntries(
          columns.map((c) => [
            c,
            comparable((r as Record<string, unknown>)[c] ?? null),
          ]),
        ),
      ),
    )
    .sort();
}

/** The same fixture through the restore step and through `db` (its tables
 *  made, the fixture's ids free) gives the same rows, ids aside; rows `db`
 *  held before are left out. */
export function expectRestoreMatchesSqlite(
  db: Database.Database,
  converters: TagConverters,
  fixture: Record<string, Record<string, unknown>[]>,
): void {
  const registry = { [TAG]: converters };
  const before = sqliteTables(db);
  const earlier = (table: string, row: unknown) =>
    (before[table] ?? []).some(
      (r) => (r as { id?: unknown }).id === (row as { id?: unknown }).id,
    );
  for (const [table, rows] of Object.entries(fixture))
    for (const row of rows) {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ).run(...cols.map((c) => asParam(row[c])));
    }
  for (const phase of ["beforeSql", "afterSql"] as const)
    runConverterSqlite(db, registry, TAG, phase);
  const restored: Record<string, unknown[]> = structuredClone(fixture);
  convertBackup(restored, registry, TAG);
  const live = sqliteTables(db);
  for (const [table, rows] of Object.entries(restored)) {
    const columns = [
      ...new Set(rows.flatMap((r) => Object.keys(r as object))),
    ].filter((c) => c !== "id");
    const ours = (live[table] ?? []).filter((r) => !earlier(table, r));
    expect(projected(ours, columns), table).toEqual(projected(rows, columns));
  }
}
