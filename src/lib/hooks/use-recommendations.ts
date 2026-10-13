"use client";

/**
 * The household's recommendations, ranked — gathered from what the
 * Milestones engine already judged, less any dismissed or snoozed. The
 * Recommendations page and the dashboard Checkup both read this, so their
 * counts agree.
 */
import { useMilestones } from "@/lib/hooks/use-milestones";
import { useRecommendationDismissals } from "@/lib/hooks/use-recommendation-dismissals";
import { applyDismissals } from "@/lib/pure/recommendation-dismissals";
import { useDataSourceStatuses } from "@/lib/hooks/use-data-source-statuses";
import { recommendationsFromDataSources } from "@/lib/pure/recommendations-data";
import { budgetApiServiceLabel } from "@/lib/utils/format";
import {
  rankRecommendations,
  recommendationsFromMilestones,
  type Recommendation,
} from "@/lib/pure/recommendations";

export function useRecommendations(): ReturnType<typeof useMilestones> & {
  recommendations: Recommendation[];
  dismissed: Recommendation[];
} {
  const milestones = useMilestones();
  const { dismissals, today } = useRecommendationDismissals();
  const data = useDataSourceStatuses();
  const ranked = rankRecommendations([
    ...recommendationsFromMilestones(milestones.results),
    ...recommendationsFromDataSources(data.statuses, (s) =>
      s.source.key === "budgetApi"
        ? budgetApiServiceLabel(data.syncStatus?.service)
        : s.source.label,
    ),
  ]);
  const { shown, dismissed } = applyDismissals(ranked, dismissals, today);
  return { ...milestones, recommendations: shown, dismissed };
}
