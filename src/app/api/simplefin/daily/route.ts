import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  runSimplefinSync,
  getSimplefinConnection,
  hasSyncedToday,
} from "@/lib/simplefin/sync";
import { log } from "@/lib/logger";
import { cronRoute } from "@/lib/auth/cron";

export async function GET(request: Request) {
  if (process.env.DEMO_ONLY === "true") {
    return NextResponse.json(
      { error: "Forbidden: demo mode is read-only" },
      { status: 403 },
    );
  }

  return cronRoute(request, syncSimplefin);
}

async function syncSimplefin(): Promise<Response> {
  // One timestamp for both the "already synced today" check and the sync, so
  // they can't straddle midnight (docs/RULES.md Time Resolution).
  const asOfDate = new Date();

  try {
    const conn = await getSimplefinConnection(db);
    if (!conn) {
      return NextResponse.json({
        skipped: true,
        reason: "No SimpleFIN connection configured",
      });
    }

    // Polled hourly (instrumentation.node.ts): skip after today's sync to save
    // SimpleFIN's ~24/day quota. Not in runSimplefinSync, so "Sync Now" can
    // always force a pull.
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
