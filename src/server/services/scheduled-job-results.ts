/**
 * Each scheduled job's last result (for /api/health/detailed), and the alert
 * webhook (`LEDGR_ALERT_WEBHOOK_URL`) a failed run posts to. Held in memory.
 */
import { log } from "@/lib/logger";

export type ScheduledJob =
  | "startup_tasks"
  | "version_snapshot"
  | "simplefin_sync"
  | "sec_refresh"
  | "tax_data_check";

/** What a run did: a short, fixed message, never a figure or a secret. */
export type JobOutcome = { ok: boolean; message: string };

export type JobResult = JobOutcome & { startedAt: string };

const ALERT_TIMEOUT_MS = 5_000;

// Next loads instrumentation and the route handlers as separate module
// instances, so the map sits on globalThis where both reach it.
declare global {
  var ledgrScheduledJobResults: Map<ScheduledJob, JobResult> | undefined;
}

function results(): Map<ScheduledJob, JobResult> {
  globalThis.ledgrScheduledJobResults ??= new Map();
  return globalThis.ledgrScheduledJobResults;
}

let refusedUrlLogged = false;

/** The webhook URL when it's set and http(s); operator-set, so not
 *  checkOutboundUrl's (url-safety.ts). An unusable one is logged once. */
function alertWebhookUrl(): URL | null {
  const value = process.env.LEDGR_ALERT_WEBHOOK_URL;
  if (!value) return null;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url?.protocol === "https:" || url?.protocol === "http:") return url;
  if (!refusedUrlLogged)
    log("warn", "job_alert_url_refused", {
      reason: "LEDGR_ALERT_WEBHOOK_URL is not an http or https URL",
    });
  refusedUrlLogged = true;
  return null;
}

/** POST a failed run to the alert webhook. Never throws, and the job never
 *  waits for it: a POST that fails or times out is logged once, not retried. */
async function sendFailureAlert(
  job: ScheduledJob,
  result: JobResult,
): Promise<void> {
  const url = alertWebhookUrl();
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "ledgr", job, ...result }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    if (!response.ok)
      log("warn", "job_alert_failed", { job, status: response.status });
  } catch (err) {
    log("warn", "job_alert_failed", {
      job,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Record a run that did work (a skipped run leaves the last result as it
 *  was); a failure also goes to the alert webhook. */
export function recordJobResult(
  job: ScheduledJob,
  startedAt: Date,
  outcome: JobOutcome,
): void {
  const result: JobResult = { ...outcome, startedAt: startedAt.toISOString() };
  results().set(job, result);
  if (!outcome.ok) void sendFailureAlert(job, result);
}

/** Each job's last recorded result; a job that hasn't run yet is absent. */
export function lastJobResults(): Partial<Record<ScheduledJob, JobResult>> {
  return Object.fromEntries(results());
}
