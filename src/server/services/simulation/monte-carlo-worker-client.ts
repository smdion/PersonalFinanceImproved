/**
 * Host-side client for the simulation worker (src/workers/monte-carlo-worker.ts): one persistent,
 * lazily spawned worker with a FIFO queue (the container has one CPU, so a pool adds only startup
 * cost). Every calculateMonteCarlo call site goes through `runMonteCarloOffThread`.
 */
import { Worker } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MonteCarloInput } from "@/lib/pure/simulation/monte-carlo.types";
import type { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";
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

// Bundled by esbuild (Dockerfile) next to server.js in the runner image; in
// dev, `pnpm build:mc-worker` produces it once for `next dev`.
const WORKER_PATH = path.join(process.cwd(), "monte-carlo-worker.js");

let worker: Worker | null = null;
const queue: QueuedJob[] = [];
let activeJob: QueuedJob | null = null;

// runId -> progress, for projection.getMonteCarloProgress (single instance, so
// in memory). Entries go when their job settles; the TTL sweep below catches a
// runId never polled again.
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
  sweepTimer.unref(); // never keep the process alive for this alone
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
        new Error(`The simulation stopped unexpectedly (code ${code})`),
      );
    }
    // A clean exit (code 0) only happens if something explicitly
    // terminated the worker — nothing in this module does that today, so
    // treat it as unexpected too if a job was mid-flight.
    else if (activeJob) {
      failActiveJobAndRespawn(
        new Error("The simulation stopped before it finished"),
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
 * Run calculateMonteCarlo() on the shared worker thread, queued behind any running simulation.
 * `runId`, if given, is the key `getMonteCarloProgress` polls under; omit it for no progress.
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
