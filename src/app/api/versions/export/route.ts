import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import { exportBackup } from "@/lib/db/version-logic";
import { log } from "@/lib/logger";

const allowDev = process.env.ALLOW_DEV_MODE === "true";

export async function GET() {
  if (process.env.DEMO_ONLY === "true") {
    return new Response("Forbidden: demo mode is read-only", { status: 403 });
  }

  try {
    // Check auth — require session with version permission or admin
    const session = await auth();
    if (!allowDev && !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !allowDev &&
      session?.user?.role !== "admin" &&
      !session?.user?.permissions.includes("version")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const backup = await exportBackup(db as Parameters<typeof exportBackup>[0]);
    const json = JSON.stringify(backup, null, 2);
    const dateStr = new Date().toISOString().split("T")[0];

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
