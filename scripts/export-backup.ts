/**
 * CLI tool: Export all versioned table data to a JSON backup file.
 *
 * Usage:
 *   pnpm backup:export                    # Write to stdout
 *   pnpm backup:export --out ./backup.json  # Write to file
 */

import * as fs from "fs";
import * as path from "path";
import { VERSION_TABLE_NAMES } from "../src/lib/db/version-tables";

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

async function exportPostgres(): Promise<Record<string, unknown[]>> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });

  const tables: Record<string, unknown[]> = {};
  const client = await pool.connect();
  try {
    for (const tableName of VERSION_TABLE_NAMES) {
      try {
        const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
        tables[tableName] = rows;
      } catch {
        tables[tableName] = [];
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return tables;
}

function exportSqlite(): Record<string, unknown[]> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Database = require("better-sqlite3");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dbPath = process.env.SQLITE_PATH ?? "data/ledgr.db";
  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("journal_mode = WAL");

  const tables: Record<string, unknown[]> = {};
  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      tables[tableName] = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
    } catch {
      tables[tableName] = [];
    }
  }

  sqlite.close();
  return tables;
}

async function run() {
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
  };

  const json = JSON.stringify(backup);

  if (outPath) {
    fs.writeFileSync(outPath, json);
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

run().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
