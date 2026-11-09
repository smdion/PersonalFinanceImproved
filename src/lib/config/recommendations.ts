/** Which judged results become a "to do" and where they sit on the Recommendations page.
 *  Urgency comes from the result (alert → now, behind → soon); order within an area follows
 *  this list after urgency and dollars. */
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
  // FOO step 3 (high-interest debt): judged from the Liabilities debts
  // list (each debt's rate against Money Guy's line for its owner's age).
  { id: "foo3", area: "moneyMoves" },
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

/** Roth IRA recommendation windows (MM-DD): for the current tax year "now" from `nowFrom` to
 *  Dec 31 (when the pro-rata balance is measured); a past tax year's contribution is "now"
 *  until the next year's filing deadline. */
export const ROTH_RECOMMENDATION_WINDOWS = {
  rothIra: { nowFrom: "10-01" },
  proRata: { nowFrom: "10-01" },
  /** Federal filing deadline for the prior tax year (IRC 6072(a)). */
  contributionDeadline: "04-15",
} as const;

/** Cheaper equivalent fund: single-class when one bucket is `singleClassMinShare` of it, flagged
 *  when its expense ratio is `minExpenseGap` or more above LOW_COST_EXPENSE_RATIO. Only in IRAs
 *  and taxable accounts (workplace and HSA menus are fixed). */
export const CHEAPER_FUND = {
  singleClassMinShare: 0.9,
  minExpenseGap: 0.001,
} as const;

/** Cash drag: the least excess cash worth an item, since the band is a share of the account
 *  and a near-empty one (e.g. a traditional IRA after a backdoor) would ask for a few cents. */
export const CASH_DRAG_MIN_EXCESS = 100;

/** Tax-loss harvesting: a taxable position whose market value is at least
 *  this share below its cost. Relative, so it fits any account size. */
export const TAX_LOSS_HARVEST = { minLossShare: 0.05 } as const;
