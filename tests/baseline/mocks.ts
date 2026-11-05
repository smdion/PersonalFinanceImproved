/**
 * Mocks both baseline suites share. Import after the dialect's harness
 * (../routers/setup-mocks or ../routers/setup-postgres) and before any app
 * module.
 */
import { vi } from "vitest";

/** Trials per simulation. Every simulation in the baseline runs in-process
 *  at this size, seeded, instead of on the worker thread at full size: the
 *  baseline pins the routers' figures for a fixed seed, and full-size runs
 *  for 17 households would take minutes. The seeded full-size run is part
 *  b's (tests/benchmarks/). */
const trials = vi.hoisted(() => 10);

vi.mock("@/server/helpers/monte-carlo-worker-client", async () => {
  const { calculateMonteCarlo } =
    await import("@/lib/pure/simulation/monte-carlo");
  return {
    runMonteCarloOffThread: async (
      input: Parameters<typeof calculateMonteCarlo>[0],
    ) =>
      calculateMonteCarlo({
        ...input,
        numTrials: Math.min(input.numTrials, trials),
      }),
    getMonteCarloProgress: () => null,
  };
});
