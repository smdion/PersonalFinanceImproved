"use client";

/**
 * The dashboard's live-plan projection: the engine input every dashboard
 * surface sends (Retirement card, Milestones, Net Worth's FI year), so they
 * all share one React Query entry and one persistent projection-cache row —
 * the cache hashes the full built input, so a near-copy would always miss.
 */
import { trpc } from "@/lib/trpc";
import { usePlanEngineInput } from "@/lib/hooks/use-plan-engine-input";
import { projectedFiYear } from "@/lib/pure/milestones";
import { milestoneProjectionYears } from "@/lib/pure/milestone-input";

/** The plan's projection (usePlanEngineInput — the same input the
 *  Retirement page sends, so the dashboard reads the page's cached runs). */
export function useDashboardProjection() {
  const { input: engineInput, ready } = usePlanEngineInput();
  const query = trpc.projection.computeProjection.useQuery(engineInput, {
    enabled: ready,
  });
  // Not ready = still loading (a disabled query reports isLoading false,
  // which would read as "no projection" for a moment).
  return { engineInput, ready, ...query, isLoading: query.isLoading || !ready };
}

/**
 * When the live plan reaches the FI number — the Milestones engine's
 * projectedFiYear over the dashboard projection, with today's cash held flat
 * (FI progress counts investments + cash). `fi` is null when the projection
 * never gets there; `hasProjection` is false until one exists.
 */
export function useProjectedFiYear(fiTargetToday: number, cashToday: number) {
  const { data, isLoading } = useDashboardProjection();
  if (!data?.result)
    return {
      isLoading,
      hasProjection: false,
      fi: null,
    } as const;
  const years = milestoneProjectionYears(
    data.result.projectionByYear,
    cashToday,
  );
  return {
    isLoading,
    hasProjection: true,
    fi: projectedFiYear(
      years,
      fiTargetToday,
      Number(data.settings.annualInflation) || 0,
      new Date().getFullYear(),
    ),
  } as const;
}
