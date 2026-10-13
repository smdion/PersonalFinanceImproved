"use client";

/**
 * The household's recommendations, ranked — gathered from what the
 * Milestones engine already judged. The Recommendations page and the
 * dashboard Checkup both read this, so their counts agree.
 */
import { useMilestones } from "@/lib/hooks/use-milestones";
import {
  rankRecommendations,
  recommendationsFromMilestones,
  type Recommendation,
} from "@/lib/pure/recommendations";

export function useRecommendations(): ReturnType<typeof useMilestones> & {
  recommendations: Recommendation[];
} {
  const milestones = useMilestones();
  return {
    ...milestones,
    recommendations: rankRecommendations(
      recommendationsFromMilestones(milestones.results),
    ),
  };
}
