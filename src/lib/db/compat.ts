/**
 * Database compatibility helpers for PostgreSQL / SQLite dual-dialect support.
 *
 * Each helper provides dialect-specific SQL for operations that differ
 * between PostgreSQL and SQLite. Import { isPostgres } from "./dialect"
 * is used at call time so the correct branch runs based on DATABASE_URL.
 */

import { sql, getTableColumns } from "drizzle-orm";
import { isPostgres } from "./dialect";
import { VERSION_TABLES } from "./version-tables";

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

/** Truncate multiple tables. PG: TRUNCATE CASCADE. SQLite: DELETE FROM each in reverse tier order. */
export async function truncateTables(
  db: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> },
  tableNames: string[],
) {
  if (isPostgres()) {
    const quoted = tableNames.map((t) => `"${t}"`).join(", ");
    await db.execute(sql.raw(`TRUNCATE ${quoted} CASCADE`));
  } else {
    // SQLite: delete in reverse tier order (children first) to respect FK constraints.
    // PRAGMA foreign_keys cannot be changed inside a transaction, so we rely on ordering.
    const reversed = [...VERSION_TABLES]
      .filter((t) => tableNames.includes(t.name))
      .sort((a, b) => b.tier - a.tier);
    for (const t of reversed) {
      await db.execute(sql.raw(`DELETE FROM "${t.name}"`));
    }
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

// ---------------------------------------------------------------------------
// Column name validation (prevents SQL injection in backup import/restore)
// ---------------------------------------------------------------------------

/** Cache of valid SQL column names per table, derived from the drizzle schema. */
let _validColumnsCache: Map<string, Set<string>> | null = null;

function buildValidColumnsCache(): Map<string, Set<string>> {
  if (_validColumnsCache) return _validColumnsCache;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const schema = isPostgres() ? require("./schema-pg") : require("./schema-sqlite");
  const cache = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    // Drizzle table objects have a Symbol that getTableColumns can read
    try {
      const cols = getTableColumns(value as Parameters<typeof getTableColumns>[0]);
      if (cols && typeof cols === "object") {
        const firstCol = Object.values(cols)[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableName = (firstCol as any)?.table?.[Symbol.for("drizzle:Name")];
        if (tableName && typeof tableName === "string") {
          cache.set(tableName, new Set(Object.values(cols).map((c: unknown) => (c as { name: string }).name)));
        }
      }
    } catch {
      // Not a table object — skip
    }
  }
  _validColumnsCache = cache;
  return cache;
}

/**
 * Validate that all column names from external data are real columns in the schema.
 * Throws if any column name is not in the whitelist — prevents SQL injection via
 * crafted backup files that contain malicious column names.
 */
export function validateColumns(tableName: string, columns: string[]): void {
  const cache = buildValidColumnsCache();
  const valid = cache.get(tableName);
  if (!valid) {
    throw new Error(`Unknown table "${tableName}" — not in schema`);
  }
  for (const col of columns) {
    if (!valid.has(col)) {
      throw new Error(
        `Invalid column "${col}" for table "${tableName}" — not in schema`,
      );
    }
  }
}
