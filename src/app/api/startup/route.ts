import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { backfillPerformanceAccountIds } from "@/lib/db/migrate/backfill-perf-ids";
import { backfillJointPersonId } from "@/lib/db/migrate/backfill-joint-person-id";
import { log } from "@/lib/logger";
import { cronRoute } from "@/lib/auth/cron";

/**
 * Internal startup route called by instrumentation.ts after server init.
 * Runs idempotent backfill tasks that migrate legacy null FKs.
 */
export async function GET(request: Request) {
  if (process.env.DEMO_ONLY === "true") {
    return NextResponse.json(
      { error: "Forbidden: demo mode is read-only" },
      { status: 403 },
    );
  }

  return cronRoute(request, runBackfills);
}

async function runBackfills(): Promise<Response> {
  const results: Record<string, string> = {};

  try {
    await backfillPerformanceAccountIds(db);
    results.perfIds = "ok";
  } catch (err) {
    log("error", "backfill_perf_ids_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    results.perfIds = "failed";
  }

  try {
    await backfillJointPersonId(db);
    results.jointPersonId = "ok";
  } catch (err) {
    log("error", "backfill_joint_person_id_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    results.jointPersonId = "failed";
  }

  return NextResponse.json({ ok: true, backfills: results });
}
