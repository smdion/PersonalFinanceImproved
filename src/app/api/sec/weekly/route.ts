import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSecConnection } from "@/lib/sec/connection";
import { secFactsRefreshDue, syncSecurityFacts } from "@/lib/sec/facts-sync";
import { log } from "@/lib/logger";
import { getValidCronSecret, timingSafeSecretMatch } from "@/lib/auth/cron";

/** Weekly SEC fund-facts refresh — polled hourly by instrumentation.node.ts; runs once a week. */
export async function GET(request: Request) {
  if (process.env.DEMO_ONLY === "true") {
    return NextResponse.json(
      { error: "Forbidden: demo mode is read-only" },
      { status: 403 },
    );
  }
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

  try {
    if (!(await getSecConnection(db)))
      return NextResponse.json({ skipped: true, reason: "SEC not set up" });
    if (!(await secFactsRefreshDue(db)))
      return NextResponse.json({ skipped: true, reason: "Checked this week" });
    const result = await syncSecurityFacts(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log("error", "sec_weekly_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during the SEC refresh" },
      { status: 500 },
    );
  }
}
