/**
 * Each scheduled job's last result (for /api/health/detailed), and the alert
 * webhook (`LEDGR_ALERT_WEBHOOK_URL`) a failing job posts to. Held in memory.
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

/** Why a post goes out: the job just failed, still fails a day after the
 *  last post, or succeeded again after a post. */
type AlertEvent = "failed" | "still_failing" | "recovered";

const ALERT_TIMEOUT_MS = 5_000;
const REMINDER_MS = 24 * 60 * 60 * 1000;

/** Each job's last result, and the start time of the failing run that last
 *  posted (absent while the job is ok). */
type JobState = {
  results: Map<ScheduledJob, JobResult>;
  alertedAt: Map<ScheduledJob, number>;
};

// Next loads instrumentation and the route handlers as separate module
// instances, so the state sits on globalThis where both reach it.
declare global {
  var ledgrScheduledJobs: JobState | undefined;
}

function jobState(): JobState {
  globalThis.ledgrScheduledJobs ??= {
    results: new Map(),
    alertedAt: new Map(),
  };
  return globalThis.ledgrScheduledJobs;
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

/** POST a run to the alert webhook. Never throws, and the job never waits
 *  for it: a POST that fails or times out is logged once, not retried. */
async function sendAlert(
  job: ScheduledJob,
  event: AlertEvent,
  result: JobResult,
): Promise<void> {
  const url = alertWebhookUrl();
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "ledgr", job, event, ...result }),
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
 *  was). The webhook hears the first failure, a reminder each 24 h of runs
 *  that still fail, and the recovery; never each failed retry. */
export function recordJobResult(
  job: ScheduledJob,
  startedAt: Date,
  outcome: JobOutcome,
): void {
  const state = jobState();
  const result: JobResult = { ...outcome, startedAt: startedAt.toISOString() };
  state.results.set(job, result);
  const alertedAt = state.alertedAt.get(job);
  if (outcome.ok) {
    if (alertedAt === undefined) return;
    state.alertedAt.delete(job);
    void sendAlert(job, "recovered", result);
    return;
  }
  if (alertedAt !== undefined && startedAt.getTime() - alertedAt < REMINDER_MS)
    return;
  state.alertedAt.set(job, startedAt.getTime());
  void sendAlert(
    job,
    alertedAt === undefined ? "failed" : "still_failing",
    result,
  );
}

/** Each job's last recorded result; a job that hasn't run yet is absent. */
export function lastJobResults(): Partial<Record<ScheduledJob, JobResult>> {
  return Object.fromEntries(jobState().results);
}
