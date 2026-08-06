import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runSimplefinSync, getSimplefinConnection } from "@/lib/simplefin/sync";
import { log } from "@/lib/logger";

export async function GET(request: Request) {
  // Validate cron secret (must be at least 32 characters when set) —
  // same pattern as src/app/api/versions/daily/route.ts.
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("X-Cron-Secret");

  if (!cronSecret || cronSecret.length < 32) {
    log("error", "cron_secret_misconfigured", {
      message: "CRON_SECRET is missing or too short",
    });
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const headerBuf = headerSecret
    ? Buffer.from(headerSecret, "utf8")
    : Buffer.alloc(0);
  const secretBuf = Buffer.from(cronSecret, "utf8");
  if (
    headerBuf.length !== secretBuf.length ||
    !timingSafeEqual(headerBuf, secretBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const conn = await getSimplefinConnection(db);
    if (!conn) {
      return NextResponse.json({
        skipped: true,
        reason: "No SimpleFIN connection configured",
      });
    }

    const result = await runSimplefinSync(db);
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
