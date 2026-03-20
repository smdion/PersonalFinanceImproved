/**
 * Database compatibility helpers for PostgreSQL / SQLite dual-dialect support.
 *
 * Each helper provides dialect-specific SQL for operations that differ
 * between PostgreSQL and SQLite. Import { isPostgres } from "./dialect"
 * is used at call time so the correct branch runs based on DATABASE_URL.
 */

import { sql } from "drizzle-orm";
import { isPostgres } from "./dialect";

// ---------------------------------------------------------------------------
// Table introspection
// ---------------------------------------------------------------------------

/** SQL to check if a table exists in the current database. */
export function tableExistsSQL(tableName: string) {
  if (isPostgres()) {
    return sql`SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS has_tables`;
  }
  return sql`SELECT EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ${tableName}
  ) AS has_tables`;
}

/** SQL to list all user tables. */
export function listTablesSQL() {
  if (isPostgres()) {
    return sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  }
  return sql`SELECT name AS tablename FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`;
}

// ---------------------------------------------------------------------------
// TRUNCATE
// ---------------------------------------------------------------------------

/** Truncate multiple tables. PG: TRUNCATE CASCADE. SQLite: DELETE FROM each. */
export async function truncateTables(
  db: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> },
  tableNames: string[],
) {
  if (isPostgres()) {
    const quoted = tableNames.map((t) => `"${t}"`).join(", ");
    await db.execute(sql.raw(`TRUNCATE ${quoted} CASCADE`));
  } else {
    // SQLite: must delete from each table individually, children first
    // Disable FK checks temporarily to avoid ordering issues
    await db.execute(sql.raw("PRAGMA foreign_keys = OFF"));
    for (const t of tableNames) {
      await db.execute(sql.raw(`DELETE FROM "${t}"`));
    }
    await db.execute(sql.raw("PRAGMA foreign_keys = ON"));
  }
}

// ---------------------------------------------------------------------------
// Serial sequence reset
// ---------------------------------------------------------------------------

/** Reset auto-increment counters after bulk insert. No-op on SQLite (automatic). */
export async function resetSequences(
  db: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> },
  tableNames: string[],
) {
  if (!isPostgres()) return; // SQLite handles autoincrement automatically
  for (const tableName of tableNames) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1, false)`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// JSONB value formatting
// ---------------------------------------------------------------------------

/** Format a JSON value for raw SQL insertion. PG: '...'::jsonb. SQLite: '...' (plain text). */
export function jsonbLiteral(val: unknown): string {
  const escaped = JSON.stringify(val).replace(/'/g, "''");
  if (isPostgres()) return `'${escaped}'::jsonb`;
  return `'${escaped}'`;
}

// ---------------------------------------------------------------------------
// Column introspection (for import)
// ---------------------------------------------------------------------------

/** Get jsonb/json column names for a table. */
export async function getJsonColumns(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { column_name: string }[] }> },
  tableName: string,
): Promise<Set<string>> {
  if (isPostgres()) {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'jsonb'`,
      [tableName],
    );
    return new Set(rows.map((r) => r.column_name));
  }
  // SQLite: no introspection for json columns — we'll use schema metadata instead
  // For now, return empty set (json columns are stored as text in SQLite)
  return new Set();
}
