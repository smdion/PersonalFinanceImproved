/**
 * CLI tool: Export all versioned table data to a JSON backup file.
 *
 * Usage:
 *   pnpm backup:export                    # Write to stdout
 *   pnpm backup:export --out ./backup.json  # Write to file
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import type { ClientBase } from "pg";
import type BetterSqlite3 from "better-sqlite3";
import { VERSION_TABLE_NAMES } from "../src/lib/db/version-tables";
import { writeBackupFile } from "../src/lib/db/backup-file";
import { loadEnvFile } from "../src/lib/db/env-file";

function getDialect(): "postgresql" | "sqlite" {
  const url = process.env.DATABASE_URL;
  if (
    url &&
    (url.startsWith("postgres://") || url.startsWith("postgresql://"))
  ) {
    return "postgresql";
  }
  return "sqlite";
}

function readSchemaVersion(): string {
  try {
    const dialect = getDialect();
    const journalDir = dialect === "postgresql" ? "drizzle" : "drizzle-sqlite";
    const journalPath = path.join(
      process.cwd(),
      journalDir,
      "meta",
      "_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entries = journal.entries;
    return entries?.[entries.length - 1]?.tag ?? "unknown";
  } catch {
    return "unknown";
  }
}

// VERSION_TABLE_NAMES imported from src/lib/db/version-tables.ts (canonical registry)

/** A table this schema doesn't have yet exports empty; any other read error fails the export. */
function tableReadError(tableName: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  return new Error(`Reading table "${tableName}" failed: ${reason}`);
}

/**
 * Every versioned table, read in one REPEATABLE READ READ ONLY transaction:
 * one snapshot, so a write that lands mid-export is in all of the tables or
 * none of them.
 */
export async function readTablesPostgres(
  client: ClientBase,
): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {};
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    for (const tableName of VERSION_TABLE_NAMES) {
      const { rows: found } = await client.query<{ present: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`"${tableName}"`],
      );
      if (!found[0]?.present) {
        tables[tableName] = [];
        continue;
      }
      try {
        const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
        tables[tableName] = rows;
      } catch (err) {
        throw tableReadError(tableName, err);
      }
    }
  } finally {
    await client.query("ROLLBACK");
  }
  return tables;
}

async function exportPostgres(): Promise<Record<string, unknown[]>> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });
  const client = await pool.connect();
  try {
    return await readTablesPostgres(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Every versioned table, read in one transaction: SQLite gives each
 * statement its own snapshot otherwise, so a write between two tables'
 * reads would land in one and not the other.
 */
export function readTablesSqlite(
  sqlite: BetterSqlite3.Database,
): Record<string, unknown[]> {
  const lookup = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = ?");
  return sqlite.transaction(() => {
    const tables: Record<string, unknown[]> = {};
    for (const tableName of VERSION_TABLE_NAMES) {
      if (lookup.get(tableName) === undefined) {
        tables[tableName] = [];
        continue;
      }
      try {
        tables[tableName] = sqlite
          .prepare(`SELECT * FROM "${tableName}"`)
          .all();
      } catch (err) {
        throw tableReadError(tableName, err);
      }
    }
    return tables;
  })();
}

function exportSqlite(): Record<string, unknown[]> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Database = require("better-sqlite3");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dbPath = process.env.SQLITE_PATH ?? "data/ledgr.db";
  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("journal_mode = WAL");
  try {
    return readTablesSqlite(sqlite);
  } finally {
    sqlite.close();
  }
}

async function run() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

  const dialect = getDialect();
  const schemaVersion = readSchemaVersion();

  console.error(
    `Exporting backup (dialect: ${dialect}, schema: ${schemaVersion})...`,
  );

  const tables =
    dialect === "postgresql" ? await exportPostgres() : exportSqlite();

  const backup = {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    tables,
    // "postgres", not "postgresql" — matches BackupData.sourceDialect in
    // src/lib/db/version-logic.ts, which importBackupPg's jsonb encoding
    // branches on.
    sourceDialect: dialect === "postgresql" ? "postgres" : "sqlite",
  };

  const json = JSON.stringify(backup);

  if (outPath) {
    writeBackupFile(outPath, json);
    const totalRows = Object.values(tables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    console.error(
      `Backup written to ${outPath} (${Object.keys(tables).length} tables, ${totalRows} rows)`,
    );
  } else {
    process.stdout.write(json);
  }
}

// Guarded so the tests can import the readers above without a run. Both
// paths are real paths, so a run through a symlinked directory still runs.
const invokedAs = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
if (invokedAs === fs.realpathSync(fileURLToPath(import.meta.url))) {
  run().catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
}
