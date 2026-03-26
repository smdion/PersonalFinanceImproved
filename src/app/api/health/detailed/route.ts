import { NextRequest, NextResponse } from "next/server";
import { db, pool, isPostgres } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getActiveBudgetApi, getApiConnection } from "@/lib/budget-api";
import { log } from "@/lib/logger";

/**
 * Detailed health endpoint with database pool stats and budget API status.
 * Requires CRON_SECRET as Bearer token for authentication.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 32) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status: Record<string, unknown> = {
    status: "ok",
    version: process.env.APP_VERSION ?? "dev",
  };

  try {
    // PG: async .execute(). SQLite (better-sqlite3): synchronous .all().
    // db is typed as NodePgDatabase but may be BetterSQLite3Database at runtime.
    if (isPostgres()) {
      await db.execute(sql`SELECT 1`);
    } else {
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
      (db as unknown as { all: (q: unknown) => unknown }).all(sql`SELECT 1`);
    }
    status.database = "connected";
    if (isPostgres() && pool) {
      status.pool = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.database = "disconnected";
    status.status = "degraded";
    // Full error details go to structured logs, not the HTTP response
    log("error", "health_check_db_failed", {
      error: message,
      code: (err as NodeJS.ErrnoException).code,
    });
  }

  // Budget API status — check api_connections table
  try {
    const active = await getActiveBudgetApi(db);
    if (active === "none") {
      status.budgetApi = "not_configured";
    } else {
      const conn = await getApiConnection(db, active);
      status.budgetApi = conn
        ? { service: active, connected: true, lastSynced: conn.lastSyncedAt }
        : { service: active, connected: false };
    }
  } catch (err) {
    status.budgetApi = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const httpStatus = status.status === "ok" ? 200 : 503;
  return NextResponse.json(status, { status: httpStatus });
}
