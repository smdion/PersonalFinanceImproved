import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  runSimplefinSync,
  getSimplefinConnection,
  hasSyncedToday,
} from "@/lib/simplefin/sync";
import { log } from "@/lib/logger";
import { getValidCronSecret, timingSafeSecretMatch } from "@/lib/auth/cron";

export async function GET(request: Request) {
  if (process.env.DEMO_ONLY === "true") {
    return NextResponse.json(
      { error: "Forbidden: demo mode is read-only" },
      { status: 403 },
    );
  }

  // Validate cron secret (must be at least 32 characters when set) —
  // same pattern as src/app/api/versions/daily/route.ts.
  const cronSecret = getValidCronSecret();

  if (!cronSecret) {
    log("error", "cron_secret_misconfigured", {
      message: "CRON_SECRET is missing or too short",
    });
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  if (
    !timingSafeSecretMatch(request.headers.get("X-Cron-Secret"), cronSecret)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolved once and threaded through both the "already synced today"
  // check and the sync call itself — two independent `new Date()` calls in
  // one request can disagree right at a midnight boundary (docs/RULES.md
  // Time Resolution).
  const asOfDate = new Date();

  try {
    const conn = await getSimplefinConnection(db);
    if (!conn) {
      return NextResponse.json({
        skipped: true,
        reason: "No SimpleFIN connection configured",
      });
    }

    // This route is polled hourly by instrumentation.node.ts; skip once
    // today's real sync has already happened so we don't burn SimpleFIN's
    // ~24-requests/day quota on repeat calls. Deliberately not applied
    // inside runSimplefinSync itself — the "Sync Now" button must always
    // be able to force a fresh pull, even on a day the cron already ran.
    if (await hasSyncedToday(db, asOfDate)) {
      return NextResponse.json({
        skipped: true,
        reason: "Already synced today",
      });
    }

    const result = await runSimplefinSync(db, asOfDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log("error", "simplefin_daily_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during SimpleFIN sync" },
      { status: 500 },
    );
  }
}
