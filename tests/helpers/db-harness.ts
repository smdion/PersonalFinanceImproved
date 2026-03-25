/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Lightweight DB harness for helper tests that need a real SQLite database
 * but don't need the full tRPC caller.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
  migrate(db, { migrationsFolder: "./drizzle-sqlite" });

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
