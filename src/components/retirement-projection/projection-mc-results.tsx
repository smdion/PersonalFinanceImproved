"use client";

/** Monte Carlo results — loading spinner, errors, warnings and compact summary bar. */
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { maskAmountsInText } from "@/lib/utils/format";
import { SIMULATION_NOT_CONFIGURED_MESSAGE } from "@/lib/pure/simulation/monte-carlo";
import type { ProjectionState } from "./projection-table-types";
import { McSimulationBar } from "./mc-simulation-bar";

/** MC loading, errors, warnings, and compact summary bar. */
export function McResultsSection({ state }: { state: ProjectionState }) {
  const {
    result,
    projectionMode,
    mcLoading,
    mcQuery,
    setShowAssumptions,
    rerunAllMc,
    isRerunning,
    clearProjectionCacheMutation,
    deflate,
    dollarMode,
  } = state;
  const utils = trpc.useUtils();
  const notConfigured =
    mcQuery.data && "notConfigured" in mcQuery.data
      ? mcQuery.data.notConfigured
      : null;

  if (projectionMode !== "monteCarlo") return null;

  // Refreshes both cache-backed simulations shown on this page together —
  // the baseline MC bar here and the Coast FIRE hero card both read from
  // the persistent projection cache, so a "re-run" should mean "give me
  // fresh randomness for both," not just one of the two. `isRerunning`
  // lives in the shared state hook (not local to this component) so the
  // top-of-page "recalculating" banner and the chart/table skeleton in
  // index.tsx can also react to it — a manual re-run previously showed
  // neither, since it bypasses the query hooks' own isFetching entirely
  // (see rerunAllMc's docblock in use-projection-queries.ts).
  const handleRerun = rerunAllMc;

  const handleClearCache = () => {
    // Whole-table wipe (no per-household scoping column exists) — confirm
    // since it affects every cached projection, not just this page's.
    if (
      !window.confirm(
        "Clear all cached projection results? Every projection page will recompute on next load.",
      )
    ) {
      return;
    }
    clearProjectionCacheMutation.mutate(undefined, {
      onSuccess: (data) => {
        toast(`Cleared ${data.cleared} cached row(s).`, "success");
        // Wiping the SERVER-side projection_cache table alone doesn't touch
        // this browser tab's own client-side query cache -- without this,
        // "Clear Cache" clears the wrong side: the server would compute
        // fresh on its NEXT request, but nothing tells this tab to actually
        // make that next request, so the table keeps showing whatever
        // computeProjection response it already has in memory. Found while
        // debugging a live household where a Bracket Ceiling
        // change genuinely persisted and genuinely changed the engine's
        // output, but "Clear Cache" alone never made the page reflect it.
        void utils.projection.invalidate();
      },
      onError: (err) => {
        toast(`Failed to clear cache: ${err.message}`, "error");
      },
    });
  };

  return (
    <div className="space-y-3">
      {/* MC loading state is handled by the unified ProjectionLoader slim strip */}
      {mcQuery.error && (
        <div className="py-4 text-sm text-red-500">
          Simulation failed: {mcQuery.error.message}
        </div>
      )}
      {notConfigured && !mcLoading && (
        <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-600">
          {SIMULATION_NOT_CONFIGURED_MESSAGE[notConfigured]}
        </div>
      )}
      {mcQuery.data?.result && !mcLoading && (
        <>
          {/* MC warnings */}
          {mcQuery.data.result.warnings.length > 0 && (
            <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
              {mcQuery.data.result.warnings.map((w) => (
                <div key={w}>{maskAmountsInText(w)}</div>
              ))}
            </div>
          )}
          {/* MC compact summary bar */}
          <McSimulationBar
            si={mcQuery.data.simulationInputs}
            mcr={mcQuery.data.result}
            result={result}
            deflate={deflate}
            dollarMode={dollarMode}
            handleRerun={handleRerun}
            isRerunning={isRerunning}
            handleClearCache={handleClearCache}
            clearProjectionCacheMutation={clearProjectionCacheMutation}
            setShowAssumptions={setShowAssumptions}
          />
        </>
      )}
      {!mcQuery.data?.result && !mcLoading && !mcQuery.error && (
        <div className="text-muted py-4 text-sm">
          No simulation data available. Ensure asset classes and glide path are
          configured.
        </div>
      )}
    </div>
  );
}
