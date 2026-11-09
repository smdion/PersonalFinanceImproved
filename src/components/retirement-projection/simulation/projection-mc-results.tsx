"use client";

/** Monte Carlo results — loading spinner, errors, warnings and compact summary bar. */
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { maskAmountsInText } from "@/lib/utils/format";
import { SIMULATION_NOT_CONFIGURED_MESSAGE } from "@/lib/pure/simulation/monte-carlo";
import type { ProjectionState } from "../projection-table-types";
import { SimulationBar } from "./mc-simulation-bar";

/** MC loading, errors, warnings, and compact summary bar. */
export function McResultsSection({ state }: { state: ProjectionState }) {
  const {
    result,
    projectionMode,
    simulationLoading,
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

  // Re-runs both cache-backed simulations (baseline MC bar and Coast FIRE hero)
  // with fresh randomness. `isRerunning` lives in the shared state hook so the
  // page banner and skeletons react too (see rerunAllMc).
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
        // Clearing the server-side projection_cache doesn't touch this tab's
        // client query cache; invalidate so the page refetches and shows
        // fresh results.
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
      {notConfigured && !simulationLoading && (
        <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-600">
          {SIMULATION_NOT_CONFIGURED_MESSAGE[notConfigured]}
        </div>
      )}
      {mcQuery.data?.result && !simulationLoading && (
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
          <SimulationBar
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
      {!mcQuery.data?.result && !simulationLoading && !mcQuery.error && (
        <div className="text-muted py-4 text-sm">
          No simulation data available. Ensure asset classes and glide path are
          configured.
        </div>
      )}
    </div>
  );
}
