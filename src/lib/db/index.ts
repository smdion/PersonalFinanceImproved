import { isPostgres } from "./dialect";
import { env } from "../env";
import { log } from "@/lib/logger";

// Re-export dialect helper for use by other modules
export { getDialect, isPostgres, isSQLite } from "./dialect";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
let _db: any;
let _pool: any = null; // only set for PG

if (isPostgres()) {
  // --- PostgreSQL ---
  const pgDrizzle = require("drizzle-orm/node-postgres");
  const pg = require("pg");
  const schema = require("./schema-pg");

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
    max: env.DATABASE_POOL_MAX ? Number(env.DATABASE_POOL_MAX) : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    options: "-c timezone=UTC",
  });

  pool.on("error", (err: Error) => {
    log("error", "pg_pool_error", {
      error: err.message,
      code: (err as NodeJS.ErrnoException).code,
    });
  });

  _pool = pool;
  _db = pgDrizzle.drizzle(pool, { schema });
} else {
  // --- SQLite (via better-sqlite3) ---
  const Database = require("better-sqlite3");
  const { drizzle: sqliteDrizzle } = require("drizzle-orm/better-sqlite3");
  const schema = require("./schema-sqlite");
  const path = require("path");
  const fs = require("fs");

  const dbPath = env.SQLITE_PATH ?? "data/ledgr.db";

  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  _db = sqliteDrizzle(sqlite, { schema });
}
/* eslint-enable */

// Export with PG types for TypeScript (the canonical types).
// At runtime, the db instance matches the active dialect.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as pgSchema from "./schema-pg";

export const db: NodePgDatabase<typeof pgSchema> = _db;
export const pool = _pool;
