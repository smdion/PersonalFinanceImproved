/**
 * One ranked list of what to do next, mapped from results other engines already judged
 * (Milestones). Nothing here judges a rule or computes a dollar figure.
 */
import {
  MILESTONE_RECOMMENDATIONS,
  RECOMMENDATION_AREAS,
  type RecommendationArea,
} from "@/lib/config/recommendations";
import type { Focus } from "@/lib/config/focus-topics";
import type { MilestoneSource } from "@/lib/config/milestones";
import type {
  MilestoneImpact,
  MilestoneResult,
} from "@/lib/pure/advice/milestones/milestones";

export type RecommendationUrgency = "now" | "soon";

export type Recommendation = {
  /** Stable: the source's own id (e.g. the milestone id). */
  id: string;
  area: RecommendationArea;
  urgency: RecommendationUrgency;
  /** A name for the item (not shown on its row — the action stands alone). */
  title: string;
  /** What to do, in one short line that stands on its own: the verb, who
   *  or which account, how much. No "how" or caveats — those go in context. */
  action: string;
  /** The how, the fallback and the figures behind it — the small line. Uses
   *  what Ledgr knows (the household's filing status, names, accounts)
   *  instead of asking the reader. */
  context: string;
  impact: MilestoneImpact | null;
  /** A yearly saving shown in retirement terms; never ranks the list. */
  yearlySaving?: number;
  /** What the recommendation is about — where its link lands. */
  focus: Focus;
  source: MilestoneSource | "ledgr";
  /** An error to fix: it can be snoozed but never dismissed for good. */
  snoozeOnly?: boolean;
};

/**
 * A yearly amount (impact or saving) compounded to the last of the plan's yearly rates, added
 * at each year's end. One-time impacts move money rather than gain it, so they have no value.
 */
export function retirementValue(
  r: Pick<Recommendation, "impact" | "yearlySaving">,
  yearlyRates: readonly number[],
): number | null {
  const amount =
    r.impact?.kind === "perYear" ? r.impact.amount : r.yearlySaving;
  if (amount === undefined || yearlyRates.length === 0) return null;
  return yearlyRates.reduce((v, rate) => v * (1 + rate) + amount, 0);
}

/** Behind (or alerting) milestones with a next step, in their configured
 *  area. Urgency is the milestone's own: alert → now, behind → soon. */
export function recommendationsFromMilestones(
  results: readonly MilestoneResult[],
  /** Subjects (e.g. funds) another recommendation already covers more
   *  precisely — a milestone about nothing else steps aside. */
  covered: ReadonlySet<string> = new Set(),
): Recommendation[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: Recommendation[] = [];
  for (const { id, area } of MILESTONE_RECOMMENDATIONS) {
    const r = byId.get(id);
    if (!r || !r.nextStep) continue;
    if (!r.alert && r.status !== "behind") continue;
    if (r.subjects?.length && r.subjects.every((x) => covered.has(x))) continue;
    out.push({
      id,
      area,
      urgency: r.alert ? "now" : "soon",
      title: r.title,
      action: r.nextStep,
      context: r.headline,
      impact: r.impact,
      yearlySaving: r.yearlySaving,
      focus: r.focus,
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
