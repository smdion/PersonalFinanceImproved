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

vi.mock("@/server/services/simulation/monte-carlo-worker-client", async () => {
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

/** The next/dynamic chunks still loading. A chunk can take longer to load
 *  than any quiet spell on a busy host, while its skeleton holds the text
 *  still, so the screens' settle (screen-mount.tsx) waits for these. */
const loadingChunks = vi.hoisted(() => new Set<Promise<unknown>>());
vi.mock("next/dynamic", async (importOriginal) => {
  const dynamic = (await importOriginal<typeof import("next/dynamic")>())
    .default;
  const tracked: typeof dynamic = (load, options) =>
    dynamic(
      typeof load === "function"
        ? () => {
            const chunk = load();
            const done = () => loadingChunks.delete(chunk);
            loadingChunks.add(chunk);
            chunk.then(done, done);
            return chunk;
          }
        : load,
      options,
    );
  return { default: tracked };
});
export { loadingChunks };

/** Suspense fallbacks on screen: a boundary still waiting. Each fallback is
 *  wrapped in a marker that counts itself while mounted and adds no DOM,
 *  so settle (screen-mount.tsx) can wait until none is shown. */
const suspenseFallbacks = vi.hoisted(() => ({ shown: 0 }));
vi.mock("react", async (importOriginal) => {
  const React = await importOriginal<typeof import("react")>();
  function FallbackMarker({ children }: { children?: React.ReactNode }) {
    React.useLayoutEffect(() => {
      suspenseFallbacks.shown++;
      return () => {
        suspenseFallbacks.shown--;
      };
    }, []);
    return children ?? null;
  }
  function Suspense(props: React.SuspenseProps) {
    return React.createElement(React.Suspense, {
      ...props,
      fallback: React.createElement(FallbackMarker, null, props.fallback),
    });
  }
  return { ...React, Suspense, default: { ...React, Suspense } };
});
export { suspenseFallbacks };
