/**
 * Host-side client for the Monte Carlo worker_threads worker
 * (src/workers/monte-carlo-worker.ts). See that file's docblock for why
 * this exists — moving calculateMonteCarlo() off the main event-loop
 * thread so a running simulation doesn't block every other request on
 * this single-instance server.
 *
 * Design (advisor-reviewed 2026-08-30, see
 * .scratch/docs/plans/PLAN-mc-worker-thread.md): ONE persistent, lazily
 * spawned worker with an in-process FIFO queue, NOT a pool and NOT
 * spawn-per-call. The container is resource-limited to cpus: 1.0
 * (docs/ops/OPS.md) so multiple workers buy no real parallelism — the fix
 * is OS-level preemption of one worker thread in favor of the main thread,
 * which a single worker already gets. A pool (or spawn-per-call) would
 * only add repeated V8-isolate-startup + bundle-reparse cost, which
 * matters here because `analyzeStrategy` alone can trigger 3+
 * calculateMonteCarlo calls in a single request (strategy.ts:224,406,577).
 *
 * All 6 calculateMonteCarlo call sites in the app route through
 * `runMonteCarloOffThread` — no exceptions (RULES.md single-computation-
 * path: the whole point of this change is "the server never blocks on MC,"
 * which a left-behind synchronous call site would silently defeat).
 */
import { Worker } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MonteCarloInput } from "@/lib/calculators/types/monte-carlo";
import type { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { log } from "@/lib/logger";

type MonteCarloResult = ReturnType<typeof calculateMonteCarlo>;

type WorkerResponse =
  | { id: string; type: "progress"; done: number; total: number }
  | { id: string; type: "result"; result: MonteCarloResult }
  | { id: string; type: "error"; message: string };

type QueuedJob = {
  id: string;
  input: MonteCarloInput;
  resolve: (result: MonteCarloResult) => void;
  reject: (err: Error) => void;
};

// Bundled by esbuild (Dockerfile) to sit next to server.js in the runner
// image — see .next/standalone layout. In dev (`next dev`), esbuild's
// output isn't rebuilt automatically; `pnpm build:mc-worker` (added to
// package.json) produces it once and `next dev` picks up the same
// checked-in-gitignored file. See Dockerfile comment for the build step.
const WORKER_PATH = path.join(process.cwd(), "monte-carlo-worker.js");

let worker: Worker | null = null;
const queue: QueuedJob[] = [];
let activeJob: QueuedJob | null = null;

// runId -> progress, for the polling procedure (projection.getMonteCarloProgress).
// Single-instance app (docs/ops/OPS.md) — an in-memory Map is the right
// weight here, no Redis/pubsub needed. Entries are removed as soon as
// their job settles; the sweep below is only a backstop for a runId whose
// caller never polls again (e.g. tab closed mid-run) so this can never
// grow unbounded.
const PROGRESS_TTL_MS = 5 * 60 * 1000;
const progressMap = new Map<
  string,
  { done: number; total: number; updatedAt: number }
>();

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [runId, entry] of progressMap) {
      if (entry.updatedAt < cutoff) progressMap.delete(runId);
    }
  }, 60 * 1000);
  sweepTimer.unref?.(); // never keep the process alive for this alone
}

/** Read current progress for a runId. Null if unknown/already finished. */
export function getMonteCarloProgress(
  runId: string,
): { done: number; total: number } | null {
  const entry = progressMap.get(runId);
  return entry ? { done: entry.done, total: entry.total } : null;
}

function spawnWorker(): Worker {
  const w = new Worker(WORKER_PATH);

  w.on("message", (msg: WorkerResponse) => {
    // Progress messages can arrive for the currently-active job only —
    // one job in flight at a time by construction (see runNext below).
    if (msg.type === "progress") {
      if (activeJob?.id === msg.id) {
        progressMap.set(msg.id, {
          done: msg.done,
          total: msg.total,
          updatedAt: Date.now(),
        });
      }
      return;
    }
    if (!activeJob || activeJob.id !== msg.id) return; // stale/unexpected
    const job = activeJob;
    activeJob = null;
    progressMap.delete(job.id);
    if (msg.type === "result") {
      job.resolve(msg.result);
    } else {
      job.reject(new Error(msg.message));
    }
    runNext();
  });

  w.on("error", (err: Error) => {
    log("error", "mc_worker_crashed", { message: err.message });
    failActiveJobAndRespawn(err);
  });

  w.on("exit", (code) => {
    if (code !== 0) {
      log("error", "mc_worker_exited_nonzero", { code });
      failActiveJobAndRespawn(
        new Error(`Monte Carlo worker exited unexpectedly (code ${code})`),
      );
    }
    // A clean exit (code 0) only happens if something explicitly
    // terminated the worker — nothing in this module does that today, so
    // treat it as unexpected too if a job was mid-flight.
    else if (activeJob) {
      failActiveJobAndRespawn(
        new Error("Monte Carlo worker exited while a job was in flight"),
      );
    }
  });

  return w;
}

function failActiveJobAndRespawn(err: Error) {
  worker = null; // force respawn on next enqueue
  const job = activeJob;
  activeJob = null;
  if (job) {
    progressMap.delete(job.id);
    job.reject(err);
  }
  // Any still-queued jobs get a fresh worker on the next runNext() call.
  runNext();
}

function runNext() {
  if (activeJob || queue.length === 0) return;
  const job = queue.shift()!;
  activeJob = job;
  progressMap.set(job.id, { done: 0, total: 0, updatedAt: Date.now() });
  if (!worker) worker = spawnWorker();
  worker.postMessage({ id: job.id, input: job.input });
}

/**
 * Run calculateMonteCarlo() on the shared worker thread instead of inline.
 * Queues behind any currently-running simulation — see module docblock for
 * why this is one worker + a queue, not a pool.
 *
 * `runId`, if given, is the key `getMonteCarloProgress` polls under —
 * pass the same id the client used to kick off the request. Omit it for
 * call sites that don't need live progress (the caller still gets the
 * correct result, just no progress reporting).
 */
export function runMonteCarloOffThread(
  input: MonteCarloInput,
  runId?: string,
): Promise<MonteCarloResult> {
  ensureSweepTimer();
  const id = runId ?? randomUUID();
  return new Promise((resolve, reject) => {
    queue.push({ id, input, resolve, reject });
    runNext();
  });
}
