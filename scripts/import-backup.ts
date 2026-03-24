/**
 * CLI tool: Import a JSON backup file into the database.
 *
 * Supports cross-version imports (v0.1.x backups are auto-transformed).
 *
 * Usage:
 *   pnpm backup:import ./backup.json              # Import backup
 *   pnpm backup:import --dry-run ./backup.json     # Preview without writing
 */

import * as fs from "fs";
import * as path from "path";

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

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: pnpm backup:import [--dry-run] <backup.json>");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const backup = JSON.parse(raw);

  if (!backup.schemaVersion || !backup.tables) {
    console.error("Invalid backup file: missing schemaVersion or tables");
    process.exit(1);
  }

  const currentVersion = readSchemaVersion();
  console.error(`Backup schema: ${backup.schemaVersion}`);
  console.error(`Current schema: ${currentVersion}`);

  // Import the transformer (uses tsconfig paths, so this script must run via tsx)
  const { transformBackupToCurrentSchema } =
    await import("../src/lib/db/backup-transforms");

  const { tables, transformed, sourceVersion } = transformBackupToCurrentSchema(
    backup.tables,
    backup.schemaVersion,
    currentVersion,
  );

  if (transformed) {
    console.error(`Transformed from ${sourceVersion} to ${currentVersion}`);
  } else {
    console.error("Schema versions match — no transformation needed");
  }

  // Summary
  const tableNames = Object.keys(tables).filter(
    (t) => Array.isArray(tables[t]) && tables[t].length > 0,
  );
  const totalRows = tableNames.reduce(
    (sum, t) => sum + (tables[t]?.length ?? 0),
    0,
  );

  console.error(`\nTables with data: ${tableNames.length}`);
  console.error(`Total rows: ${totalRows}`);

  if (dryRun) {
    console.error("\n--- Dry run summary ---");
    for (const t of tableNames) {
      console.error(`  ${t}: ${tables[t].length} rows`);
    }
    console.error("\nNo changes made (--dry-run).");
    return;
  }

  // Actual import — delegate to version-logic
  console.error("\nImporting...");

  // We need a DB connection + the importBackup function
  const dialect = getDialect();

  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
    });

    try {
      const db = drizzle(pool);
      const { importBackup } = await import("../src/lib/db/version-logic");
      const result = await importBackup(db, {
        schemaVersion: backup.schemaVersion,
        exportedAt: backup.exportedAt,
        tables: backup.tables, // importBackup handles transformation internally
      });
      console.error(
        `Import complete: ${result.restoredTables} tables, ${result.restoredRows} rows`,
      );
    } finally {
      await pool.end();
    }
  } else {
    console.error(
      "SQLite CLI import not yet implemented. Use the web UI at /versions.",
    );
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
