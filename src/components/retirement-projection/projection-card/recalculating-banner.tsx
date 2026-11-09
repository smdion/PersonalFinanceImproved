/** The fixed "Recalculating…" banner, with trial progress when reported. */
import { formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import type { ProjectionState } from "../projection-table-types";

export function RecalculatingBanner({ state }: { state: ProjectionState }) {
  const {
    engineQuery,
    mcPrefetchQuery,
    mcQuery,
    coastFireMcQuery,
    rateSeededMcQuery,
    coastFireProbeLoading,
    isRerunning,
    simulationProgressQuery,
    simulationPrefetchProgressQuery,
    coastFireSimulationProgressQuery,
    rateSeededSimulationProgressQuery,
    coastFireProbeProgressQuery,
  } = state;
  // Pinned to the top of the viewport, it covers every query that can make
  // the user wait; only the simulation reports trials done (its worker's
  // progress messages), the rest show the plain state.
  const isRecalculating =
    engineQuery.isFetching ||
    mcPrefetchQuery.isFetching ||
    mcQuery.isFetching ||
    coastFireMcQuery.isFetching ||
    rateSeededMcQuery.isFetching ||
    coastFireProbeLoading ||
    isRerunning;
  // The run the user is looking at outranks the background prefetch; each
  // progress query has data only while its own run is in flight, so the
  // chain matters only when two overlap (Re-run starts two).
  const simulationProgress = mcQuery.isFetching
    ? (simulationProgressQuery.data ?? null)
    : coastFireMcQuery.isFetching
      ? (coastFireSimulationProgressQuery.data ?? null)
      : rateSeededMcQuery.isFetching
        ? (rateSeededSimulationProgressQuery.data ?? null)
        : coastFireProbeLoading
          ? (coastFireProbeProgressQuery.data ?? null)
          : mcPrefetchQuery.isFetching
            ? (simulationPrefetchProgressQuery.data ?? null)
            : isRerunning
              ? (simulationProgressQuery.data ??
                coastFireSimulationProgressQuery.data ??
                null)
              : null;
  if (!isRecalculating) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md print:hidden"
    >
      <span
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
        aria-hidden="true"
      />
      {simulationProgress && simulationProgress.total > 0 ? (
        <>
          <span>
            Running simulation… {simulationProgress.done.toLocaleString()}
            {" / "}
            {simulationProgress.total.toLocaleString()} trials (
            {formatPercent(
              safeDivide(simulationProgress.done, simulationProgress.total, 0),
              0,
            )}
            )
          </span>
          <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full rounded-full bg-white transition-[width]"
              style={{
                width: `${Math.min(100, safeDivide(simulationProgress.done, simulationProgress.total, 0) * 100)}%`,
              }}
            />
          </span>
        </>
      ) : (
        <span>Recalculating…</span>
      )}
    </div>
  );
}
