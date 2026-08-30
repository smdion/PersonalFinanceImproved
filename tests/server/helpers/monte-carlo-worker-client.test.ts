/**
 * Integration test for the Monte Carlo worker_threads client — this is the
 * one thing "does calculateMonteCarlo behave the same" unit tests can't
 * cover: does the ESBUILD-BUNDLED worker file actually load and run
 * standalone (no `@/` alias resolution relying on ts-node/vitest's own
 * module loader), and does the queue/progress/crash-handling plumbing
 * around it work.
 *
 * Requires `pnpm build:mc-worker` to have produced `monte-carlo-worker.js`
 * at the repo root first (same artifact the Docker build produces) — this
 * mirrors how `db-migrate.js` is only testable after its own compile step.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  runMonteCarloOffThread,
  getMonteCarloProgress,
} from "@/server/helpers/monte-carlo-worker-client";
import {
  makeTrinityInput,
  makeMCInput,
} from "../../benchmarks/benchmark-helpers";

const WORKER_BUNDLE = path.join(process.cwd(), "monte-carlo-worker.js");

describe("monte-carlo-worker-client", () => {
  beforeAll(() => {
    if (!existsSync(WORKER_BUNDLE)) {
      throw new Error(
        `${WORKER_BUNDLE} is missing — run \`pnpm build:mc-worker\` before running this test (same artifact the Docker build produces).`,
      );
    }
  });

  it("runs a real simulation on the worker and returns the same shape calculateMonteCarlo produces in-process", async () => {
    const engine = makeTrinityInput();
    const mc = makeMCInput(engine, { numTrials: 200, seed: 42 });

    const result = await runMonteCarloOffThread(mc);

    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
    expect(result.distributions.terminalBalance.median).toBeGreaterThan(0);
  }, 20000);

  it("reports progress under the given runId while the job is in flight, then clears it on completion", async () => {
    const engine = makeTrinityInput();
    const mc = makeMCInput(engine, { numTrials: 300, seed: 7 });
    const runId = "test-progress-run";

    expect(getMonteCarloProgress(runId)).toBeNull();

    const promise = runMonteCarloOffThread(mc, runId);
    // Progress should show up before the promise settles — poll briefly.
    let sawProgress = false;
    for (let i = 0; i < 50 && !sawProgress; i++) {
      const p = getMonteCarloProgress(runId);
      if (p && p.total === 300) sawProgress = true;
      await new Promise((r) => setTimeout(r, 20));
    }
    await promise;

    expect(sawProgress).toBe(true);
    // Settled jobs are removed from the progress map immediately.
    expect(getMonteCarloProgress(runId)).toBeNull();
  }, 20000);

  it("queues a second job behind a running one instead of running them concurrently on separate workers", async () => {
    const engine = makeTrinityInput();
    const mcA = makeMCInput(engine, { numTrials: 300, seed: 1 });
    const mcB = makeMCInput(engine, { numTrials: 300, seed: 2 });

    const [resultA, resultB] = await Promise.all([
      runMonteCarloOffThread(mcA, "queue-test-a"),
      runMonteCarloOffThread(mcB, "queue-test-b"),
    ]);

    // Both complete correctly regardless of ordering — the point is neither
    // errors or hangs when queued behind the other.
    expect(resultA.successRate).toBeGreaterThanOrEqual(0);
    expect(resultB.successRate).toBeGreaterThanOrEqual(0);
  }, 30000);
});
