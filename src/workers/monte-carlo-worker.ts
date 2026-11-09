/**
 * Worker thread for calculateMonteCarlo's CPU-bound loop, off the server's event loop. Bundled
 * standalone by esbuild (Dockerfile): no framework/DB imports. Host posts `{ id, input }`; this
 * posts `progress`, then one `result` or `error` (see monte-carlo-worker-client.ts).
 */
import { parentPort } from "node:worker_threads";
import { calculateMonteCarlo } from "@/lib/pure/simulation/monte-carlo";
import type { MonteCarloInput } from "@/lib/pure/simulation/monte-carlo.types";

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
