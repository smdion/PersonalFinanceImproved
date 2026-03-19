import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";
import { log } from "@/lib/logger";

export const pool = new Pool({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  ssl: env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : false,
  max: env.DATABASE_POOL_MAX ? Number(env.DATABASE_POOL_MAX) : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000, // 30s — kill runaway queries before they hold connections
});

// Log pool-level errors (idle client errors, unexpected disconnects).
// Without this handler, pool errors crash the process silently.
pool.on("error", (err) => {
  log("error", "pg_pool_error", {
    error: err.message,
    host: env.DATABASE_HOST,
    database: env.DATABASE_NAME,
    code: (err as NodeJS.ErrnoException).code,
  });
});

export const db = drizzle(pool, { schema });
