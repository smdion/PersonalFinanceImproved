import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkForTaxDataUpdate,
  taxDataCheckDue,
  taxDataSyncOffReason,
} from "@/lib/tax-data/sync";
import { log } from "@/lib/logger";
import { getValidCronSecret, timingSafeSecretMatch } from "@/lib/auth/cron";

/** Weekly community tax-data check — polled hourly by instrumentation.node.ts; runs once a week when turned on. */
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
    if (await taxDataSyncOffReason(db))
      return NextResponse.json({ skipped: true, reason: "Turned off" });
    if (!(await taxDataCheckDue(db)))
      return NextResponse.json({ skipped: true, reason: "Checked this week" });
    const result = await checkForTaxDataUpdate(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log("error", "tax_data_weekly_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during the tax-data check" },
      { status: 500 },
    );
  }
}
