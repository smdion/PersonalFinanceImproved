/**
 * Recommendations — one ranked list of what to do next, gathered from
 * results other engines already judged (the Milestones engine today). Each
 * source is an adapter that only maps fields: nothing here judges a rule
 * or works out a dollar figure.
 */
import {
  MILESTONE_RECOMMENDATIONS,
  RECOMMENDATION_AREAS,
  type RecommendationArea,
} from "@/lib/config/recommendations";
import type { MilestoneSource } from "@/lib/config/milestones";
import type { MilestoneImpact, MilestoneResult } from "@/lib/pure/milestones";

export type RecommendationUrgency = "now" | "soon";

export type Recommendation = {
  /** Stable: the source's own id (e.g. the milestone id). */
  id: string;
  area: RecommendationArea;
  urgency: RecommendationUrgency;
  title: string;
  /** What to do. */
  action: string;
  /** Where things stand, for context. */
  context: string;
  impact: MilestoneImpact | null;
  href: string;
  source: MilestoneSource | "ledgr";
};

/** Behind (or alerting) milestones with a next step, in their configured
 *  area. Urgency is the milestone's own: alert → now, behind → soon. */
export function recommendationsFromMilestones(
  results: readonly MilestoneResult[],
): Recommendation[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: Recommendation[] = [];
  for (const { id, area } of MILESTONE_RECOMMENDATIONS) {
    const r = byId.get(id);
    if (!r || !r.nextStep) continue;
    if (!r.alert && r.status !== "behind") continue;
    out.push({
      id,
      area,
      urgency: r.alert ? "now" : "soon",
      title: r.title,
      action: r.nextStep,
      context: r.headline,
      impact: r.impact,
      href: r.href,
      source: r.source,
    });
  }
  return out;
}

const URGENCY_ORDER: Record<RecommendationUrgency, number> = {
  now: 0,
  soon: 1,
};

/**
 * Urgency first, then — only among the same kind of dollars — the larger
 * yearly amount, then the configured order (areas, then each area's list).
 * One-time and yearly dollars are never compared with each other.
 */
export function rankRecommendations(
  recommendations: readonly Recommendation[],
): Recommendation[] {
  const areaOrder = new Map(RECOMMENDATION_AREAS.map((a, i) => [a.key, i]));
  const configOrder = new Map(
    MILESTONE_RECOMMENDATIONS.map((m, i) => [m.id as string, i]),
  );
  const perYear = (r: Recommendation) =>
    r.impact?.kind === "perYear" ? r.impact.amount : 0;
  return [...recommendations].sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      perYear(b) - perYear(a) ||
      (areaOrder.get(a.area) ?? 99) - (areaOrder.get(b.area) ?? 99) ||
      (configOrder.get(a.id) ?? 99) - (configOrder.get(b.id) ?? 99),
  );
}
