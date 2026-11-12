import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import { versionRouteCaller } from "@/server/services/versions/route-gate";
import { exportBackup } from "@/lib/db/backup/version-logic";
import { log } from "@/lib/logger";
import { calendarDateOf } from "@/lib/utils/calendar-date";

export async function GET() {
  if (process.env.DEMO_ONLY === "true") {
    return new Response("Forbidden: demo mode is read-only", { status: 403 });
  }

  try {
    const caller = await versionRouteCaller("export", auth);
    if (caller instanceof Response) return caller;

    // Anyone but an admin gets the household's data only (no logins,
    // access settings or credentials).
    const backup = await exportBackup(
      db as Parameters<typeof exportBackup>[0],
      {
        asAdmin: caller.asAdmin,
      },
    );
    const json = JSON.stringify(backup, null, 2);
    const dateStr = calendarDateOf(new Date());

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ledgr-backup-${dateStr}.json"`,
      },
    });
  } catch (error) {
    log("error", "export_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during export" },
      { status: 500 },
    );
  }
}
