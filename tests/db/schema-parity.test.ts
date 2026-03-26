/**
 * Schema Parity Test — PG vs SQLite
 *
 * Verifies that both Drizzle schema definitions export the same tables
 * with the same column names. Catches structural drift between dialects
 * that the `as unknown as DbType` cast would otherwise mask at compile time.
 */
import { describe, it, expect } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import * as pgSchema from "@/lib/db/schema-pg";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all Drizzle table objects from a schema module */
function extractTables(
  schema: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const tables = new Map<string, Record<string, unknown>>();
  for (const [exportName, value] of Object.entries(schema)) {
    // Drizzle tables have a Symbol-keyed property; getTableName returns a string for tables
    try {
      const name = getTableName(value as never);
      if (name) tables.set(exportName, value as Record<string, unknown>);
    } catch {
      // Not a table — skip (could be a type, relation, or helper)
    }
  }
  return tables;
}

function getColumnNames(table: unknown): string[] {
  try {
    const cols = getTableColumns(table as never);
    return Object.keys(cols).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const pgTables = extractTables(pgSchema);
const sqliteTables = extractTables(sqliteSchema);

describe("Schema parity: Postgres vs SQLite", () => {
  it("both schemas export the same number of tables", () => {
    expect(pgTables.size).toBe(sqliteTables.size);
    expect(pgTables.size).toBeGreaterThan(0);
  });

  it("both schemas export the same table names", () => {
    const pgNames = [...pgTables.keys()].sort();
    const sqliteNames = [...sqliteTables.keys()].sort();
    expect(pgNames).toEqual(sqliteNames);
  });

  // Per-table column parity
  for (const [exportName, pgTable] of pgTables) {
    describe(`table: ${exportName}`, () => {
      it("exists in SQLite schema", () => {
        expect(sqliteTables.has(exportName)).toBe(true);
      });

      it("has the same columns", () => {
        const sqliteTable = sqliteTables.get(exportName);
        if (!sqliteTable) return; // covered by existence test above

        const pgCols = getColumnNames(pgTable);
        const sqliteCols = getColumnNames(sqliteTable);

        expect(pgCols).toEqual(sqliteCols);
      });

      it("has the same SQL table name", () => {
        const sqliteTable = sqliteTables.get(exportName);
        if (!sqliteTable) return;

        const pgName = getTableName(pgTable as never);
        const sqliteName = getTableName(sqliteTable as never);
        expect(pgName).toBe(sqliteName);
      });
    });
  }
});
