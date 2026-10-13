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
  const ranked = rankRecommendations(
    recommendationsFromMilestones(milestones.results),
  );
  const { shown, dismissed } = applyDismissals(ranked, dismissals, today);
  return { ...milestones, recommendations: shown, dismissed };
}
