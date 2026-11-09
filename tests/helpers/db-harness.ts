/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Lightweight DB harness for helper tests that need a real SQLite database
 * but don't need the full tRPC caller.
 */
import { withAsyncTransactions } from "@/lib/db/sqlite-transactions";
import {
  SIMULATION_PRESETS_FILE,
  TAX_DATA_DIR,
  parseSimulationPresets,
  readTaxDataDir,
  reconcileReferenceRowsSync,
  seedSimulationPresetsSync,
  SIMULATION_PRESET_TABLES,
} from "@/lib/db/migrate/reference-reconcile-core";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as pgSchema from "@/lib/db/schema-pg";

type DbType = NodePgDatabase<typeof pgSchema>;

export interface TestDbContext {
  db: BetterSQLite3Database<typeof sqliteSchema>;
  rawDb: DbType;
  schema: typeof sqliteSchema;
  /** The same tables typed as the app's schema — use with `rawDb`. */
  appSchema: typeof pgSchema;
  cleanup: () => void;
}

/** The migrated, seeded database, built once per test worker. */
let template: Buffer | null = null;

/**
 * A fresh in-memory test database: a copy of a template that has every
 * migration and the reference data (IRS limits, tax brackets, the shipped
 * Simulation presets) applied.
 * Building that template takes ~85ms; copying it takes well under 1ms, so
 * it's built once per worker instead of once per test. A reference-data
 * load that fails throws here — tests must never run on a half-seeded DB.
 */
export function openTestSqlite(): InstanceType<typeof Database> {
  if (!template) {
    const t = new Database(":memory:");
    applyMigrations(t);
    // Reference data from the tax-data file and the presets file, through
    // the same reconcile and seed the migrator runs.
    const run = (text: string, params: unknown[]) => {
      const stmt = t.prepare(text);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    };
    reconcileReferenceRowsSync(
      run,
      readTaxDataDir(fs, path.resolve(TAX_DATA_DIR)),
    );
    seedSimulationPresetsSync(
      run,
      parseSimulationPresets(
        fs.readFileSync(path.resolve(SIMULATION_PRESETS_FILE), "utf-8"),
      ),
    );
    template = t.serialize();
    t.close();
  }
  const sqlite = new Database(template);
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

/** Empty the preset tables the template ships filled, for a test that
 *  builds its own asset classes and presets (rows that point at them go
 *  too). */
export function clearSimulationPresets(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): void {
  for (const t of [
    "glide_path_allocations",
    ...[...SIMULATION_PRESET_TABLES].reverse(),
  ])
    db.run(sql.raw(`DELETE FROM ${t}`));
}

export async function createTestDb(): Promise<TestDbContext> {
  const sqlite = openTestSqlite();
  const db = drizzle(sqlite, { schema: sqliteSchema });

  // The same transactions a SQLite install runs: real commit and rollback.
  withAsyncTransactions(db, sqlite);

  const rawDb = db as unknown as DbType;

  const cleanup = () => {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  };

  return {
    db,
    rawDb,
    schema: sqliteSchema,

    appSchema: sqliteSchema as unknown as typeof pgSchema,
    cleanup,
  };
}

/**
 * Apply the SQLite migrations to a fresh database the way the migrator
 * applies pending ones: every statement must succeed (db-migrate.ts skips
 * "already done" errors only in a squash replay). A migration that only
 * works by skipping errors fails here, as it would on a fresh install.
 */
function applyMigrations(
  sqlite: InstanceType<typeof Database>,
  migrationsFolder = "./drizzle-sqlite",
): void {
  const journalPath = path.resolve(`${migrationsFolder}/meta/_journal.json`);
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string }[];
  };
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto");
  const applied = new Set(
    (
      sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
        hash: string;
      }[]
    ).map((r) => r.hash),
  );
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");
    if (applied.has(hash)) continue;
    const stmts = sql
      .split("--> statement-breakpoint")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const applyTx = sqlite.transaction(() => {
      for (const stmt of stmts) sqlite.exec(stmt);
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(hash, Date.now());
    });
    applyTx();
  }
}
