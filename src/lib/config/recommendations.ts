/**
 * Recommendations — which judged results become a "to do", and where they
 * sit on the Recommendations page. Urgency isn't configured: it comes from
 * the result itself (alert → now, behind → soon). Order within an area
 * follows this list after urgency and dollars.
 */
import type { BuiltInMilestoneId } from "@/lib/config/milestones";

export type RecommendationArea =
  "paycheck" | "moneyMoves" | "safety" | "home" | "investing" | "data";

export const RECOMMENDATION_AREAS: {
  key: RecommendationArea;
  title: string;
  blurb: string;
}[] = [
  {
    key: "paycheck",
    title: "Your paycheck",
    blurb: "Changes to what comes out of each check.",
  },
  {
    key: "moneyMoves",
    title: "Moving money",
    blurb: "Where the next dollar should go.",
  },
  { key: "safety", title: "Safety", blurb: "Cash and protection." },
  { key: "home", title: "Home", blurb: "The house and its loan." },
  {
    key: "investing",
    title: "Investing",
    blurb: "What you hold and what it costs.",
  },
  {
    key: "data",
    title: "Keep data current",
    blurb: "Figures Ledgr needs refreshed to stay right.",
  },
];

/** Milestones that become recommendations when Behind (or alerting), by
 *  area, in priority order within the area. Journey, wealth and custom
 *  goals are outcomes, not actions — they stay on the Milestones page. */
export const MILESTONE_RECOMMENDATIONS: readonly {
  id: BuiltInMilestoneId;
  area: RecommendationArea;
}[] = [
  { id: "foo2", area: "paycheck" },
  { id: "foo6", area: "paycheck" },
  { id: "foo5", area: "paycheck" },
  { id: "savingsRate", area: "paycheck" },
  { id: "pfRetirementRate", area: "paycheck" },
  // foo3 (high-interest debt) returns once the debts list gives it rates —
  // until then it can only be reached or unknown, never a to-do.
  { id: "goalHorizon", area: "moneyMoves" },
  { id: "moneyGuyCheckpoints", area: "moneyMoves" },
  { id: "fidelityCheckpoints", area: "moneyMoves" },
  { id: "emergencyFund", area: "safety" },
  { id: "protection", area: "safety" },
  { id: "housing", area: "home" },
  { id: "paidOffHome", area: "home" },
  { id: "rebalance", area: "investing" },
  { id: "fundCosts", area: "investing" },
  { id: "lowCost", area: "investing" },
];
