/**
 * Milestones — the shapes `evaluateMilestones()` reads and returns, and the
 * stored milestone settings (custom goals, checklist, sources) with their
 * schemas. Split from milestones.ts, which holds the rules themselves and
 * re-exports everything here.
 */
import { z } from "zod/v4";
import type { Focus } from "@/lib/config/focus-topics";
import {
  CHECKPOINT_SOURCES,
  CUSTOM_GOAL_METRICS,
  DEFAULT_CHECKPOINT_SOURCE,
  DEFAULT_SAVINGS_TARGET_SOURCE,
  MAX_CUSTOM_GOALS,
  MILESTONE_CHECKLIST_ITEMS,
  SAVINGS_TARGET_SOURCES,
  type CheckpointSource,
  type CustomGoalMetric,
  type MilestoneChecklistItem,
  type MilestoneDefinition,
  type SavingsTargetSource,
} from "@/lib/config/milestones";
import type { HouseholdSavings } from "@/lib/pure/contributions";
import type { CompositionBucket, DebtKind } from "@/lib/config/enum-values";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One year of household history, as the milestones read it. */
export type MilestoneYear = {
  year: number;
  isCurrent: boolean;
  /** Household age (average of the people) — the wealth formula's age. */
  age: number;
  /** Market-value net worth. */
  netWorth: number;
  /** Liquid investments: every investment account plus cash. */
  liquid: number;
  cash: number;
  retirement: number;
  brokerage: number;
  /** Gross pretax income — see wealthFormulaIncome. */
  grossIncome: number;
  /** A full year's contributions incl. employer money (finalized years
   *  only — the current year's are still accruing). */
  contributions: number | null;
  /** Wealth-formula score (net worth ÷ expected net worth). */
  wealthScore: number;
  fiProgress: number;
  mortgageBalance: number;
  otherLiabilities: number;
};

/** One projected year, as the milestones read it. */
export type MilestoneProjectionYear = {
  year: number;
  age: number;
  /** Projected investments plus today's cash held flat. */
  liquid: number;
  /** Projected gross pay (null once retired). */
  salary: number | null;
  /** Projected contributions incl. employer money (null once retired). */
  contributions: number | null;
};

export type MilestoneLimit = {
  /** An IRA/HSA limit — FOO step 5 (config `fooStep`). */
  fooStep5: boolean;
  /** In the Retirement parent category — counts toward FOO step 6. */
  retirement: boolean;
  /** Who it's for ("Household" for a household-wide limit). */
  owner: string;
  /** The account-type label, e.g. "IRA". */
  label: string;
  contributed: number;
  limit: number;
  /** Filled through payroll (true), outside it (false — an IRA, an HSA
   *  funded directly: this year's room stays open until the filing
   *  deadline), or unknown (null — nothing contributed yet). */
  payroll?: boolean | null;
  /** The owner's paychecks left this year (payroll rows). */
  checksLeft?: number | null;
};

/** An account getting less than its full employer match. */
export type MatchShortfall = {
  owner: string;
  label: string;
  /** Match left on the table a year. */
  missed: number;
  /** Percent of pay elected now (whole number); null for a fixed amount. */
  currentPct: number | null;
  /** Percent of pay that gets the full match; null when it doesn't
   *  depend on the rate. */
  fullPct: number | null;
};

export type MilestoneChecklist = Partial<
  Record<MilestoneChecklistItem, boolean>
>;

export const customGoalSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  metric: z.enum(
    Object.keys(CUSTOM_GOAL_METRICS) as [
      CustomGoalMetric,
      ...CustomGoalMetric[],
    ],
  ),
  target: z.number().positive().max(1e12),
  /** Grow the target with inflation from the year it was set. */
  todaysDollars: z.boolean(),
  /** The year the target is in "today's dollars" of. */
  setYear: z.number().int().min(1900).max(2200),
});
export type CustomGoal = z.infer<typeof customGoalSchema>;

export const customGoalsSchema = z
  .array(customGoalSchema)
  .max(MAX_CUSTOM_GOALS)
  .refine((goals) => new Set(goals.map((g) => g.id)).size === goals.length, {
    message: "Goal ids must be unique",
  });

export const milestoneChecklistSchema = z
  .object(
    Object.fromEntries(
      Object.keys(MILESTONE_CHECKLIST_ITEMS).map((k) => [
        k,
        z.boolean().optional(),
      ]),
    ) as Record<MilestoneChecklistItem, z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();

export const checkpointSourceSchema = z.enum(
  Object.keys(CHECKPOINT_SOURCES) as [CheckpointSource, ...CheckpointSource[]],
);

export const savingsTargetSourceSchema = z.enum(
  Object.keys(SAVINGS_TARGET_SOURCES) as [
    SavingsTargetSource,
    ...SavingsTargetSource[],
  ],
);

/** Stored settings → validated values. Anything unreadable reads as empty
 *  (writes are validated with the same schemas, so this only guards old or
 *  hand-edited data). */
export function parseMilestoneSettings(raw: {
  customGoals: unknown;
  checklist: unknown;
  checkpointSource?: unknown;
  savingsTargetSource?: unknown;
}): {
  customGoals: CustomGoal[];
  checklist: MilestoneChecklist;
  checkpointSource: CheckpointSource;
  savingsTargetSource: SavingsTargetSource;
} {
  const goals = customGoalsSchema.safeParse(raw.customGoals);
  const checklist = milestoneChecklistSchema.safeParse(raw.checklist);
  const source = checkpointSourceSchema.safeParse(raw.checkpointSource);
  const target = savingsTargetSourceSchema.safeParse(raw.savingsTargetSource);
  return {
    customGoals: goals.success ? goals.data : [],
    checklist: checklist.success ? checklist.data : {},
    checkpointSource: source.success ? source.data : DEFAULT_CHECKPOINT_SOURCE,
    savingsTargetSource: target.success
      ? target.data
      : DEFAULT_SAVINGS_TARGET_SOURCE,
  };
}

/** A debt from the Liabilities list, as milestones judge it. */
export type MilestoneDebt = {
  name: string;
  kind: DebtKind;
  balance: number;
  /** Annual rate (fraction); null when not entered. */
  rate: number | null;
  /** The owner's age today (the household's for a joint debt). */
  ownerAge: number;
  open: boolean;
  /** Estimated payoff year at its monthly payment; null when no payment or
   *  rate is entered, it never pays off (`never`), or the estimate has
   *  already passed (`stale`). */
  payoffYear: number | null;
  never: boolean;
  /** Still open but its estimated payoff has passed — the balance is out
   *  of date. */
  stale: boolean;
  paidOffYear: number | null;
};

export type MilestoneInput = {
  asOfYear: number;
  /** Oldest first; the last row is the current year. */
  years: MilestoneYear[];
  projection: {
    years: MilestoneProjectionYear[];
    inflationRate: number;
  } | null;
  /** FI number in today's dollars (yearly expenses ÷ withdrawal rate). */
  fiTarget: number;
  /** Money Guy savings rates (match counted below the high-income
   *  threshold) and this year's totals. */
  savings: {
    /** Retirement + Portfolio money — the 25% rule and FOO step 7. */
    rate: number;
    /** Retirement category only — FOO step 6's "25% before maxing out". */
    retirementRate: number;
    saved: number;
    savedWithMatch: number;
    compensation: number;
    matchCounted: boolean;
    /** At or above the household's high-income threshold. */
    highIncome: boolean;
    highIncomeThreshold: number;
    /** Both goal groups with the match rule applied, for the breakdown. */
    breakdown: HouseholdSavings;
  } | null;
  match: {
    captured: number;
    available: number;
    /** Each account getting less than its full match. */
    shortfalls?: MatchShortfall[];
  } | null;
  limits: MilestoneLimit[] | null;
  /** A year's employee contributions to Retirement accounts that have no
   *  IRS limit (shown next to step 6, never part of its limit test). */
  retirementUnlimited: number | null;
  efundMonths: number | null;
  /** Essential expenses a month (the emergency-fund goal's basis); null
   *  when unknown. */
  efundEssentialMonthly?: number | null;
  mortgage: {
    active: boolean;
    monthlyHousingCost: number;
    payoffYear: number | null;
    /** Today's balance, annual rate (fraction) and principal + interest a
     *  month — sizing an extra payment; absent when unknown. */
    balance?: number | null;
    annualRate?: number | null;
    principalAndInterest?: number | null;
  } | null;
  holdings: {
    /** Share of the portfolio whose asset class is known. */
    coverage: number;
    /** Dollars whose mix is known — the shares' denominator. */
    knownValue: number;
    /** Dollars in fund categories not linked to any asset class. */
    unlinkedValue: number;
    /** Dollars in SimpleFIN accounts not linked to a Ledgr account. */
    unlinkedAccountsValue?: number;
    classes: {
      name: string;
      share: number;
      targetShare: number | null;
      /** Dollars of this class in taxable accounts, and in tax-advantaged
       *  ones (where a rebalancing sale costs no tax). */
      taxableValue?: number;
      shelteredValue?: number;
    }[];
    expenseRatio: number | null;
    /** Share of the portfolio with a known expense ratio. */
    costCoverage: number;
    /** Each held fund with a known expense ratio and main category. */
    funds: {
      name: string;
      bucket: CompositionBucket;
      expenseRatio: number;
      /** Held in an account whose funds the household picks (an IRA,
       *  a taxable account) — not only in fixed workplace/HSA menus. */
      switchable?: boolean;
    }[];
  } | null;
  /** The Liabilities debts list; null/absent before it's loaded. */
  debts?: MilestoneDebt[] | null;
  /** The other-debt figures that aren't itemized: the typed lump and the
   *  credit cards mapped from the budget. */
  otherDebt?: { manual: number; creditCardMapped: number } | null;
  checklist: MilestoneChecklist;
  customGoals: CustomGoal[];
  /** Which income-multiple checkpoints the household follows. */
  checkpointSource: CheckpointSource;
  /** Which savings-rate rule the household follows. */
  savingsTargetSource: SavingsTargetSource;
  /** After-tax ("mega backdoor") room per person: the IRS total-additions
   *  limit less employee deferrals (catch-up excluded) and employer money. */
  megaBackdoor: { owner: string; room: number; limit: number }[] | null;
  /** Active brokerage goals (money held in the brokerage account). */
  brokerageGoals: { name: string; targetYear: number }[] | null;
};

export type MilestoneImpact = {
  /** perYear: a yearly amount (match missed, savings gap, unused room);
   *  oneTime: a lump to reach a target. */
  kind: "perYear" | "oneTime";
  amount: number;
};

export type MilestoneStatus = "reached" | "onTrack" | "behind" | "unknown";

export type MilestoneValue = {
  kind: "currency" | "percent" | "multiple" | "months" | "count";
  amount: number;
};

export type MilestoneResult = MilestoneDefinition & {
  status: MilestoneStatus;
  /** Needs action now (the Checkup's red). */
  alert: boolean;
  value: MilestoneValue | null;
  target: MilestoneValue | null;
  /** 0–1 toward the target, when it's a distance. */
  progress: number | null;
  /** Your figure against the rule, in a few words. */
  headline: string;
  /** A badge-sized version of the headline (the dashboard Checkup). */
  short: string;
  /** Reached / expected context ("Reached 2023", "On pace for 2031"). */
  note: string | null;
  /** The step that closes the gap or gets there sooner. */
  nextStep: string | null;
  /** Where the next step is done, when that isn't the milestone's own page. */
  nextStepFocus?: Focus;
  /** The funds (or other things) the next step is about — lets another
   *  recommendation that already covers them stand in for this one. */
  subjects?: string[];
  reachedYear: number | null;
  expectedYear: number | null;
  expectedAge: number | null;
  /** Everything this milestone contributes to the timeline. */
  achievements: { year: number; label: string }[];
  /** The dollars closing the gap would move — set where the gap is already
   *  worked out, so Recommendations rank by it without re-deriving it. */
  impact: MilestoneImpact | null;
};
