/**
 * Node.js-only instrumentation handlers.
 *
 * Dynamically imported by instrumentation.ts so that Turbopack does not
 * bundle process.on / process.exit into the Edge Runtime chunk.
 */

import { log } from "@/lib/logger";
import { reportError } from "@/lib/error-reporting";

let versionInterval: ReturnType<typeof setInterval> | undefined;
let simplefinInterval: ReturnType<typeof setInterval> | undefined;

export function registerNodeHandlers() {
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
    if (simplefinInterval) clearInterval(simplefinInterval);
    process.exit(0);
  });

  // Delay to let the server fully initialize before self-fetching
  setTimeout(() => {
    runStartupTasks();
    runAutoVersionCheck();
    // Check every hour; the API route skips if already ran today
    versionInterval = setInterval(runAutoVersionCheck, 60 * 60 * 1000);
  }, 30_000);

  // SimpleFIN's own developer docs ask clients to pick a random minute
  // rather than polling on the hour ("we get more traffic at the top of
  // the hour"). A random 0-55min startup jitter (not persisted — doesn't
  // need to be stable across restarts, just spread across processes)
  // decouples the daily sync's effective fire time from container boot
  // time, on top of the hourly check itself already skipping once today's
  // real sync has happened (see hasSyncedToday in lib/simplefin/sync.ts).
  const simplefinJitterMs = Math.floor(Math.random() * 55 * 60 * 1000);
  setTimeout(() => {
    runSimplefinDailyCheck();
    simplefinInterval = setInterval(runSimplefinDailyCheck, 60 * 60 * 1000);
  }, 30_000 + simplefinJitterMs);
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

async function runSimplefinDailyCheck() {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log("warn", "simplefin_daily_skipped", {
        reason: "CRON_SECRET not set",
      });
      return;
    }

    const res = await fetch(`${getBaseUrl()}/api/simplefin/daily`, {
      headers: { "X-Cron-Secret": cronSecret },
    });
    const body = await res.json();

    if (body.ok) {
      log("info", "simplefin_daily_synced", {
        accountCount: body.accountCount,
      });
    } else if (body.skipped) {
      // Normal — no connection configured, or already synced today
    } else {
      log("warn", "simplefin_daily_unexpected", { body });
    }
  } catch (err) {
    if (err instanceof Error) {
      reportError(err, { context: "simplefin_daily_check" });
    } else {
      log("error", "simplefin_daily_failed", { error: String(err) });
    }
  }
}
