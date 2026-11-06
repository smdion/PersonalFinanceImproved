/**
 * Part d's reading of the database (DECISIONS.md "Sync-write pins"): every
 * table's rows as JSON, and the rows a call added or changed between two
 * readings. sync-writes.test.ts and finalize-writes.test.ts share it, and
 * pins-postgres.test.ts reads PostgreSQL the same way (tableRowsPg).
 */
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { createTestCaller } from "../routers/setup";

type Db = Awaited<ReturnType<typeof createTestCaller>>["db"];
/** Each table's rows, as sorted JSON strings. */
export type Rows = Map<string, string[]>;

/** Not written: timestamps, and the connection config (encrypted with a
 *  fresh random IV every save). */
export const NOT_PINNED = /At$|^config$/;
/** Not a write under test: the change log's audit row for the call itself
 *  (logMutation, trpc.ts), which reaches the test db since setup-mocks
 *  forwards the top-level db to it. Pinned before that, so left out. */
const NOT_PINNED_TABLES = new Set(["change_log"]);

/** A table's rows as sorted JSON strings, without the unpinned columns. */
function pinnedRows(rows: Record<string, unknown>[]): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row).filter(([k]) => !NOT_PINNED.test(k)),
        ),
      ),
    )
    .sort();
}

/** Every table's rows, as JSON strings, without the unpinned columns. */
export function tableRows(db: Db): Rows {
  const out: Rows = new Map();
  for (const table of Object.values(sqliteSchema)) {
    if (!is(table, SQLiteTable)) continue;
    if (NOT_PINNED_TABLES.has(getTableConfig(table).name)) continue;
    const rows = db.select().from(table).all() as Record<string, unknown>[];
    out.set(getTableConfig(table).name, pinnedRows(rows));
  }
  return out;
}

/** tableRows on PostgreSQL: the same tables, read through the app's
 *  PostgreSQL schema (loaded when called, after the harness points the
 *  app at the test database). */
export async function tableRowsPg(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<Rows> {
  const schema = await import("@/lib/db/schema-pg");
  const { PgTable, getTableConfig: pgTableConfig } =
    await import("drizzle-orm/pg-core");
  const out: Rows = new Map();
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const name = pgTableConfig(table).name;
    if (NOT_PINNED_TABLES.has(name)) continue;
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    out.set(name, pinnedRows(rows));
  }
  return out;
}

/** Per table: the rows `after` has that `before` didn't (written or
 *  changed), and how many of `before`'s rows are gone or changed. */
export function writtenRows(before: Rows, after: Rows) {
  const out: Record<string, { written: unknown[]; replacedOrRemoved: number }> =
    {};
  for (const [table, rows] of after) {
    const old = new Set(before.get(table) ?? []);
    const now = new Set(rows);
    const written = rows.filter((r) => !old.has(r));
    const gone = [...old].filter((r) => !now.has(r)).length;
    if (written.length || gone)
      out[table] = {
        written: written.map((r): unknown => JSON.parse(r)),
        replacedOrRemoved: gone,
      };
  }
  return out;
}
