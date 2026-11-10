import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { devBypass } from "@/server/auth-mode";
import { auth } from "@/server/auth";
import { refuseWhileDemoActive } from "@/server/services/demo/demo-session";
import { exportBackup } from "@/lib/db/backup/version-logic";
import { log } from "@/lib/logger";
import { calendarDateOf } from "@/lib/utils/calendar-date";

export async function GET() {
  if (process.env.DEMO_ONLY === "true") {
    return new Response("Forbidden: demo mode is read-only", { status: 403 });
  }

  try {
    // Require a session with version permission or admin. Only `next dev` with
    // ALLOW_DEV_MODE skips it (auth-mode.ts); validateEnv() refuses it in prod.
    const allowDev = devBypass() === "admin";
    const session = await auth();
    if (!allowDev && !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !allowDev &&
      session?.user.role !== "admin" &&
      !session?.user.permissions.includes("version")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const demoActive = await refuseWhileDemoActive("export");
    if (demoActive) return demoActive;

    const backup = await exportBackup(db as Parameters<typeof exportBackup>[0]);
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
