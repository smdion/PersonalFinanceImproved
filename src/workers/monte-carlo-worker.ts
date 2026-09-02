/**
 * worker_threads entry point for calculateMonteCarlo().
 *
 * Why this exists: calculateMonteCarlo() is a synchronous, CPU-bound loop
 * (up to numTrials × calculateProjection() calls, each across ~40-60 years)
 * with no `await`/yields. Called directly inside a tRPC handler it blocks
 * Node's single JS event-loop thread for the entire run — not just this
 * request, the WHOLE SERVER, for every user, until it finishes (found
 * 2026-08-30 from a live "entire UI freezes" report; verified by reading
 * the loop, not assumed). Running it on a separate OS thread lets the OS
 * scheduler preempt it in favor of the main thread even under this
 * container's `cpus: 1.0` limit (docs/ops/OPS.md) — there's no real
 * parallelism gain from a second thread on one CPU, but preemption alone
 * is the actual fix: the main thread keeps getting scheduled time instead
 * of running one synchronous callback to completion.
 *
 * This file is NOT part of the Next.js build — it's bundled standalone via
 * esbuild (see Dockerfile) into a self-contained CJS file with every
 * `@/lib/...` import inlined, then copied into the runner image next to
 * `server.js`, the same pattern `db-migrate.ts` already uses for its own
 * one-file compile step. Do not add framework/DB imports here — this
 * process has none of Next's request context, and calculateMonteCarlo
 * itself is a pure calculator (no DB, no tRPC, no React) that never needed
 * any.
 *
 * Protocol (see src/server/helpers/monte-carlo-worker-client.ts for the
 * host side): the host posts `{ id, input }`; this worker posts
 * `{ id, type: "progress", done, total }` zero or more times, then exactly
 * one of `{ id, type: "result", result }` or `{ id, type: "error", message }`.
 * One job in flight at a time — the host serializes calls via its own
 * queue, so `id` only needs to distinguish which job a message belongs to
 * for logging/assertions, not to support real concurrency inside this file.
 */
import { parentPort } from "node:worker_threads";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import type { MonteCarloInput } from "@/lib/calculators/types/monte-carlo";

export type WorkerRequest = {
  id: string;
  input: MonteCarloInput;
};

export type WorkerResponse =
  | { id: string; type: "progress"; done: number; total: number }
  | {
      id: string;
      type: "result";
      result: ReturnType<typeof calculateMonteCarlo>;
    }
  | { id: string; type: "error"; message: string };

if (!parentPort) {
  throw new Error(
    "monte-carlo-worker.ts must be run as a worker_threads Worker, not as a standalone script (no parentPort).",
  );
}
const port = parentPort;

port.on("message", (req: WorkerRequest) => {
  try {
    const result = calculateMonteCarlo(req.input, (done, total) => {
      const msg: WorkerResponse = { id: req.id, type: "progress", done, total };
      port.postMessage(msg);
    });
    const msg: WorkerResponse = { id: req.id, type: "result", result };
    port.postMessage(msg);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const msg: WorkerResponse = { id: req.id, type: "error", message };
    port.postMessage(msg);
  }
});
