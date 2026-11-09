import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checkForTaxDataUpdate,
  taxDataCheckDue,
  taxDataSyncOffReason,
} from "@/server/services/tax/tax-data-sync";
import { log } from "@/lib/logger";
import { cronRoute } from "@/lib/auth/cron";

/** Weekly community tax-data check — polled hourly by instrumentation.node.ts; runs once a week when turned on. */
export async function GET(request: Request) {
  if (process.env.DEMO_ONLY === "true") {
    return NextResponse.json(
      { error: "Forbidden: demo mode is read-only" },
      { status: 403 },
    );
  }
  return cronRoute(request, checkTaxData);
}

async function checkTaxData(): Promise<Response> {
  try {
    if (await taxDataSyncOffReason(db))
      return NextResponse.json({ skipped: true, reason: "Turned off" });
    if (!(await taxDataCheckDue(db, new Date())))
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
