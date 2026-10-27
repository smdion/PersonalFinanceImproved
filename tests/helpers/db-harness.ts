/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Lightweight DB harness for helper tests that need a real SQLite database
 * but don't need the full tRPC caller.
 */
import {
  TAX_DATA_DIR,
  readTaxDataDir,
  reconcileReferenceRowsSync,
} from "@/lib/db/reference-reconcile-core";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as pgSchema from "@/lib/db/schema-pg";

type DbType = NodePgDatabase<typeof pgSchema>;

export interface TestDbContext {
  db: BetterSQLite3Database<typeof sqliteSchema>;
  rawDb: DbType;
  schema: typeof sqliteSchema;
  cleanup: () => void;
}

/** The migrated, seeded database, built once per test worker. */
let template: Buffer | null = null;

/**
 * A fresh in-memory test database: a copy of a template that has every
 * migration and the reference data (IRS limits, tax brackets) applied.
 * Building that template takes ~85ms; copying it takes well under 1ms, so
 * it's built once per worker instead of once per test. A reference-data
 * load that fails throws here — tests must never run on a half-seeded DB.
 */
export function openTestSqlite(): InstanceType<typeof Database> {
  if (!template) {
    const t = new Database(":memory:");
    applyMigrationsIdempotent(t);
    // Reference data from the tax-data file, through the same reconcile
    // the migrator runs.
    reconcileReferenceRowsSync(
      (text, params) => {
        const stmt = t.prepare(text);
        if (stmt.reader)
          return stmt.all(...params) as Record<string, unknown>[];
        stmt.run(...params);
        return [];
      },
      readTaxDataDir(fs, path.resolve(TAX_DATA_DIR)),
    );
    template = t.serialize();
    t.close();
  }
  const sqlite = new Database(template);
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export async function createTestDb(): Promise<TestDbContext> {
  const sqlite = openTestSqlite();
  const db = drizzle(sqlite, { schema: sqliteSchema });

  // Monkey-patch db.transaction so helpers using async transaction
  // callbacks can run under the better-sqlite3 test harness — mirrors the
  // identical patch in tests/routers/setup.ts (see its comment for why:
  // production is Postgres, which supports async transactions natively;
  // better-sqlite3 rejects them with "Transaction function cannot return a
  // promise"). No real atomicity here, but the logic inside is testable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).transaction = async (fn: (tx: unknown) => unknown) => fn(db);

  const rawDb = db as unknown as DbType;

  const cleanup = () => {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  };

  return { db, rawDb, schema: sqliteSchema, cleanup };
}

/**
 * Apply SQLite migrations idempotently, ignoring "already exists" / "duplicate
 * column" errors that arise when the squash migration (0000) was generated from
 * a later schema snapshot, causing 0001 to re-add tables/columns 0000 already
 * created. Mirrors the savepoint logic in db-migrate.ts.
 */
export function applyMigrationsIdempotent(
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
      for (const stmt of stmts) {
        try {
          sqlite.exec(stmt);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column")
          ) {
            // idempotent — skip
          } else {
            throw e;
          }
        }
      }
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(hash, Date.now());
    });
    applyTx();
  }
}
