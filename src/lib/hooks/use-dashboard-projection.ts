"use client";

/**
 * The dashboard's live-plan projection. Every dashboard surface sends the same
 * engine input so they share one query entry and one projection-cache row.
 */
import { trpc } from "@/lib/trpc";
import { usePlanEngineInput } from "@/lib/hooks/use-plan-engine-input";
import { projectedFiYear } from "@/lib/pure/advice/milestones/milestones.shared";
import { milestoneProjectionYears } from "@/lib/pure/advice/milestones/input";

/** The plan's projection (usePlanEngineInput — the same input the
 *  Retirement page sends, so the dashboard reads the page's cached runs). */
export function useDashboardProjection() {
  const { input: engineInput, ready, gate } = usePlanEngineInput();
  const query = trpc.projection.computeProjection.useQuery(engineInput, {
    enabled: ready,
  });
  // Not ready = still loading (a disabled query reports isLoading false,
  // which would read as "no projection" for a moment).
  return {
    engineInput,
    ready,
    gate,
    ...query,
    isLoading: query.isLoading || !ready,
  };
}

/**
 * When the live plan reaches the FI number, with today's cash held flat. `fi`
 * is null when it never does; `hasProjection` is false until a projection exists.
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
