import { NextResponse } from "next/server";
import { db, pool } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getActiveBudgetApi, getApiConnection } from "@/lib/budget-api";
import { log } from "@/lib/logger";

export async function GET() {
  const status: Record<string, unknown> = {
    status: "ok",
    version: process.env.APP_VERSION ?? "dev",
  };

  try {
    await db.execute(sql`SELECT 1`);
    status.database = "connected";
    status.pool = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.database = "disconnected";
    status.databaseError = message;
    status.status = "degraded";
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
