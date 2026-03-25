/**
 * Next.js instrumentation — runs once on server startup.
 *
 * - Registers global error handlers for structured logging
 * - Runs auto-versioning via self-fetch to /api/versions/daily
 * - Runs backfills via self-fetch to /api/startup
 *
 * All DB-dependent work goes through API routes to avoid webpack
 * bundling Node.js-only modules (pg, fs, path) in the instrumentation
 * entry point.
 */

import { log } from "@/lib/logger";
import { reportError } from "@/lib/error-reporting";

let versionInterval: ReturnType<typeof setInterval> | undefined;

export async function register() {
  // Only run on the Node.js server runtime (not edge).
  // Use globalThis check — referencing process.on directly throws in Edge.
  if (
    typeof globalThis.process === "undefined" ||
    typeof globalThis.process.on !== "function"
  )
    return;

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    reportError(err, { context: "unhandled_rejection" });
  });
  process.on("uncaughtException", (err) => {
    reportError(err, { context: "uncaught_exception" });
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    log("info", "sigterm_received", { message: "Shutting down gracefully" });
    if (versionInterval) clearInterval(versionInterval);
    process.exit(0);
  });

  // Delay to let the server fully initialize before self-fetching
  setTimeout(() => {
    runStartupTasks();
    runAutoVersionCheck();
    // Check every hour; the API route skips if already ran today
    versionInterval = setInterval(runAutoVersionCheck, 60 * 60 * 1000);
  }, 30_000);
}

function getBaseUrl(): string {
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

async function runStartupTasks() {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return;

    const res = await fetch(`${getBaseUrl()}/api/startup`, {
      headers: { "X-Cron-Secret": cronSecret },
    });
    const body = await res.json();

    if (body.ok) {
      log("info", "startup_tasks_completed", body);
    } else {
      log("warn", "startup_tasks_failed", { body });
    }
  } catch (err) {
    if (err instanceof Error) {
      reportError(err, { context: "startup_tasks" });
    } else {
      log("error", "startup_tasks_failed", { error: String(err) });
    }
  }
}

async function runAutoVersionCheck() {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log("warn", "auto_version_skipped", { reason: "CRON_SECRET not set" });
      return;
    }

    const res = await fetch(`${getBaseUrl()}/api/versions/daily`, {
      headers: { "X-Cron-Secret": cronSecret },
    });
    const body = await res.json();

    if (body.ok) {
      log("info", "auto_version_created", { version: body.version });
    } else if (body.skipped) {
      // Normal — already created today or schedule doesn't match
    } else {
      log("warn", "auto_version_unexpected", { body });
    }
  } catch (err) {
    if (err instanceof Error) {
      reportError(err, { context: "auto_version_check" });
    } else {
      log("error", "auto_version_failed", { error: String(err) });
    }
  }
}
