import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq, and, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings, stateVersions } from "@/lib/db/schema";
import { createVersion } from "@/lib/db/version-logic";
import { log } from "@/lib/logger";

export async function GET(request: Request) {
  // Validate cron secret (must be at least 32 characters when set)
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

  try {
    // Check if auto-versioning is enabled
    const settings = await db.select().from(appSettings);
    const scheduleSetting = settings.find(
      (s) => s.key === "version_auto_schedule",
    );
    const schedule =
      typeof scheduleSetting?.value === "string"
        ? scheduleSetting.value
        : "daily";

    if (schedule === "off") {
      return NextResponse.json({
        skipped: true,
        reason: "Auto-versioning is disabled",
      });
    }

    // For preset schedules, check if today matches.
    // 'custom' always runs — the cron expression controls invocation externally.
    const today = new Date();
    if (schedule === "weekly" && today.getDay() !== 0) {
      return NextResponse.json({ skipped: true, reason: "Weekly: not Sunday" });
    }
    if (schedule === "monthly" && today.getDate() !== 1) {
      return NextResponse.json({
        skipped: true,
        reason: "Monthly: not 1st of month",
      });
    }

    // Use local date (respects TZ env) — not UTC — so the version name
    // matches the calendar day the user sees.
    const dateStr = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    // Skip if an auto version already exists with today's name (e.g. container restart).
    // Match by name rather than timestamp — avoids PG/SQLite cast differences.
    const existing = await db
      .select({ id: stateVersions.id })
      .from(stateVersions)
      .where(
        and(
          eq(stateVersions.versionType, "auto"),
          like(stateVersions.name, `Auto ${dateStr}%`),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({
        skipped: true,
        reason: "Auto version already exists for today",
      });
    }

    const version = await createVersion(
      db as Parameters<typeof createVersion>[0],
      {
        name: `Auto ${dateStr}`,
        type: "auto",
        createdBy: "system (cron)",
      },
    );

    return NextResponse.json({ ok: true, version });
  } catch (error) {
    log("error", "daily_version_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "An internal error occurred during version creation" },
      { status: 500 },
    );
  }
}
