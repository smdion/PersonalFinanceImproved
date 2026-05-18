/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Lightweight DB harness for helper tests that need a real SQLite database
 * but don't need the full tRPC caller.
 */
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

export async function createTestDb(): Promise<TestDbContext> {
  const tmpDir = path.join(process.cwd(), "tests", ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const dbPath = path.join(
    tmpDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema: sqliteSchema });
  applyMigrationsIdempotent(sqlite);

  // Seed reference data
  const seedPath = path.resolve("seed-reference-data.sql");
  if (fs.existsSync(seedPath)) {
    try {
      sqlite.exec(fs.readFileSync(seedPath, "utf-8"));
    } catch {
      // Non-fatal
    }
  }

  const rawDb = db as unknown as DbType;

  const cleanup = () => {
    try {
      sqlite.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath + "-wal");
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath + "-shm");
    } catch {
      /* */
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
