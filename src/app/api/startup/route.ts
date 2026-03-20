import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { backfillPerformanceAccountIds } from "@/lib/db/backfill-perf-ids";
import { backfillMappingLocalIds } from "@/lib/db/backfill-local-ids";
import { log } from "@/lib/logger";

/**
 * Internal startup route called by instrumentation.ts after server init.
 * Runs idempotent backfill tasks that migrate legacy null FKs.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("X-Cron-Secret");

  if (!cronSecret || cronSecret.length < 32) {
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  if (
    !headerSecret ||
    headerSecret.length !== cronSecret.length ||
    !timingSafeEqual(
      Buffer.from(headerSecret, "utf8"),
      Buffer.from(cronSecret, "utf8"),
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    await backfillMappingLocalIds(db);
    results.localIds = "ok";
  } catch (err) {
    log("error", "backfill_local_ids_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    results.localIds = "failed";
  }

  return NextResponse.json({ ok: true, backfills: results });
}
