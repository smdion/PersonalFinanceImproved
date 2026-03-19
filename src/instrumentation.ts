/**
 * Next.js instrumentation — runs once on server startup.
 * Sets up a daily auto-versioning timer so no external cron is needed.
 *
 * Error monitoring: uses reportError() from @/lib/error-reporting.
 * To add Sentry or another provider, update that module — all call sites
 * automatically pick up the new implementation.
 */

import { log } from "@/lib/logger";
import { reportError } from "@/lib/error-reporting";

let versionInterval: ReturnType<typeof setInterval> | undefined;

export async function register() {
  // Only run on the server (not edge runtime)
  if (typeof globalThis.setInterval === "undefined") return;

  // Catch unhandled promise rejections and uncaught exceptions so they
  // get structured logging instead of silent crashes.
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    reportError(err, { context: "unhandled_rejection" });
  });
  process.on("uncaughtException", (err) => {
    reportError(err, { context: "uncaught_exception" });
    // Must exit — Node.js state is unreliable after uncaught exception
    process.exit(1);
  });

  // Graceful shutdown: drain DB pool and clear timers
  process.on("SIGTERM", async () => {
    log("info", "sigterm_received", { message: "Shutting down gracefully" });
    if (versionInterval) clearInterval(versionInterval);
    try {
      const { pool } = await import("@/lib/db");
      await pool.end();
      log("info", "pool_drained");
    } catch (err) {
      if (err instanceof Error) {
        reportError(err, { context: "pool_drain" });
      } else {
        log("error", "pool_drain_failed", { error: String(err) });
      }
    }
    process.exit(0);
  });

  // Delay start by 30s to let the DB connection pool warm up
  setTimeout(async () => {
    // Auto-backfill deprecated null FKs (idempotent, non-blocking)
    try {
      const { db } = await import("@/lib/db");
      const { backfillPerformanceAccountIds } = await import("@/lib/db/backfill-perf-ids");
      await backfillPerformanceAccountIds(db);
    } catch (err) {
      if (err instanceof Error) reportError(err, { context: "backfill_perf_ids" });
      else log("error", "backfill_perf_ids_failed", { error: String(err) });
    }

    try {
      const { db } = await import("@/lib/db");
      const { backfillMappingLocalIds } = await import("@/lib/db/backfill-local-ids");
      await backfillMappingLocalIds(db);
    } catch (err) {
      if (err instanceof Error) reportError(err, { context: "backfill_local_ids" });
      else log("error", "backfill_local_ids_failed", { error: String(err) });
    }

    runAutoVersionCheck();
    // Check every hour; the handler skips if already ran today
    versionInterval = setInterval(runAutoVersionCheck, 60 * 60 * 1000);
  }, 30_000);
}

async function runAutoVersionCheck() {
  try {
    const { db } = await import("@/lib/db");
    const { appSettings, stateVersions } = await import("@/lib/db/schema");
    const { createVersion } = await import("@/lib/db/version-logic");
    const { eq, and, gte, sql } = await import("drizzle-orm");

    // Read schedule setting
    const settings = await db.select().from(appSettings);
    const scheduleSetting = settings.find(
      (s) => s.key === "version_auto_schedule",
    );
    const schedule =
      typeof scheduleSetting?.value === "string"
        ? scheduleSetting.value
        : "daily";

    if (schedule === "off") return;

    const today = new Date();

    // Check schedule matches today
    if (schedule === "weekly" && today.getDay() !== 0) return;
    if (schedule === "monthly" && today.getDate() !== 1) return;

    // Skip if an auto version was already created today
    const todayStr = today.toISOString().split("T")[0]!;
    const existing = await db
      .select({ id: stateVersions.id })
      .from(stateVersions)
      .where(
        and(
          eq(stateVersions.versionType, "auto"),
          gte(stateVersions.createdAt, sql`${todayStr}::timestamp`),
        ),
      )
      .limit(1);

    if (existing.length > 0) return;

    await createVersion(db as Parameters<typeof createVersion>[0], {
      name: `Auto ${todayStr}`,
      type: "auto",
      createdBy: "system (internal-cron)",
    });

    log("info", "auto_version_created", { date: todayStr });
  } catch (err) {
    if (err instanceof Error) {
      reportError(err, { context: "auto_version_check" });
    } else {
      log("error", "auto_version_failed", { error: String(err) });
    }
  }
}
