/**
 * Milestones — the one place financial rules and milestones are judged.
 *
 * The Milestones page, the dashboard Financial Checkup and the Retirement
 * card's readiness row all read `evaluateMilestones()`; none of them judges
 * a rule on its own. Pure: callers gather the household's figures (yearly
 * history, the live contribution/savings/mortgage summaries, the deterministic
 * projection, linked holdings) and pass them in. Thresholds and wording live
 * in `lib/config/milestones.ts`.
 *
 * Reached dates come from the yearly history (finalized years, plus the
 * current year for point-in-time balances); expected dates come from the
 * Retirement projection — the same run the dashboard Retirement card shows.
 */
import { z } from "zod/v4";
import {
  getAccountTypeConfig,
  getAllCategories,
  isRetirementParent,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types.types";
import {
  CHECKPOINT_START_AGE,
  CUSTOM_GOAL_METRICS,
  EMERGENCY_FUND_MONTHS,
  FIDELITY_CHECKPOINTS,
  FIRST_100K,
  HOLDINGS_MIN_COVERAGE,
  HOUSING_COST_SHARE,
  LIMIT_FILLED_TOLERANCE,
  LOW_COST_EXPENSE_RATIO,
  MAX_CUSTOM_GOALS,
  MILESTONE_BY_ID,
  MILESTONE_CHECKLIST_ITEMS,
  MONEY_GUY_CHECKPOINTS,
  MONEY_GUY_NAPKIN_RETURN,
  MONEY_GUY_SAVINGS_RATE,
  ONE_MILLION,
  PAID_OFF_HOME_BY_AGE,
  PROTECTION_CHECKLIST_AGE,
  REBALANCE_BANDS,
  CHECKPOINT_SOURCES,
  DEFAULT_CHECKPOINT_SOURCE,
  DEFAULT_SAVINGS_TARGET_SOURCE,
  FUND_MAIN_BUCKET_SHARE,
  GOAL_HORIZON_YEARS,
  PF_FUND_EXPENSE_RATIO,
  PF_RETIREMENT_RATE,
  SAVINGS_TARGET_SOURCES,
  type SavingsTargetSource,
  type BuiltInMilestoneId,
  type CheckpointSource,
  type CustomGoalMetric,
  type IncomeCheckpoint,
  type MilestoneChecklistItem,
  type MilestoneDefinition,
} from "@/lib/config/milestones";
import {
  SAVINGS_RATE_DECIMALS,
  WEALTH_FORMULA_MULTIPLIER,
  WEALTH_TIER_PAW_MIN,
} from "@/lib/constants";
import {
  COMPOSITION_BUCKET_LABELS,
  wealthScoreTier,
} from "@/lib/config/display-labels";
import type { CompositionBucket } from "@/lib/config/enum-values";
import {
  compactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  householdSavings,
  householdTotalCompensation,
  isHighIncomeHousehold,
  type HouseholdSavings,
  type SavingsRatePerson,
} from "@/lib/pure/contributions";

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

/** The money a checkpoint table measures: Money Guy counts liquid
 *  investments (retirement + brokerage + HSA + cash), Fidelity retirement
 *  savings only. */
export function checkpointBalance(
  source: CheckpointSource,
  y: Pick<MilestoneYear, "liquid" | "retirement">,
): number {
  return source === "moneyGuy" ? y.liquid : y.retirement;
}

export type MilestoneInput = {
  asOfYear: number;
  /** Oldest first; the last row is the current year. */
  years: MilestoneYear[];
  projection: {
    years: MilestoneProjectionYear[];
    inflationRate: number;
    /** The projection is a what-if scenario, not the live plan. */
    isScenario: boolean;
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
  match: { captured: number; available: number } | null;
  limits: MilestoneLimit[] | null;
  /** A year's employee contributions to Retirement accounts that have no
   *  IRS limit (shown next to step 6, never part of its limit test). */
  retirementUnlimited: number | null;
  efundMonths: number | null;
  mortgage: {
    active: boolean;
    monthlyHousingCost: number;
    payoffYear: number | null;
  } | null;
  holdings: {
    /** Share of the portfolio whose asset class is known. */
    coverage: number;
    /** Dollars whose mix is known — the shares' denominator. */
    knownValue: number;
    /** Dollars in fund categories not linked to any asset class. */
    unlinkedValue: number;
    classes: { name: string; share: number; targetShare: number | null }[];
    expenseRatio: number | null;
    /** Share of the portfolio with a known expense ratio. */
    costCoverage: number;
    /** Each held fund with a known expense ratio and main category. */
    funds: { name: string; bucket: CompositionBucket; expenseRatio: number }[];
  } | null;
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
  reachedYear: number | null;
  expectedYear: number | null;
  expectedAge: number | null;
  /** Everything this milestone contributes to the timeline. */
  achievements: { year: number; label: string }[];
  /** The dollars closing the gap would move — set where the gap is already
   *  worked out, so Recommendations rank by it without re-deriving it. */
  impact: MilestoneImpact | null;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The income multiple a checkpoint table expects at an age (linear between
 *  checkpoints, from 0× at CHECKPOINT_START_AGE; flat past the last). */
export function incomeMultipleTarget(
  checkpoints: readonly IncomeCheckpoint[],
  age: number,
): number {
  let previous: IncomeCheckpoint = { age: CHECKPOINT_START_AGE, multiple: 0 };
  for (const cp of checkpoints) {
    if (age <= cp.age) {
      if (age <= previous.age) return previous.multiple;
      const t = (age - previous.age) / (cp.age - previous.age);
      return previous.multiple + t * (cp.multiple - previous.multiple);
    }
    previous = cp;
  }
  return previous.multiple;
}

/** First history year that meets a test. Finalized years only unless
 *  `includeCurrent` (point-in-time balances can count the current year;
 *  yearly flows can't, since they're still accruing). */
export function firstReachedYear(
  years: readonly MilestoneYear[],
  test: (y: MilestoneYear) => boolean,
  includeCurrent = true,
): number | null {
  for (const y of years) {
    if (!includeCurrent && y.isCurrent) continue;
    if (test(y)) return y.year;
  }
  return null;
}

/** First projected year after `asOfYear` that meets a test. */
export function firstProjectedYear(
  years: readonly MilestoneProjectionYear[],
  asOfYear: number,
  test: (y: MilestoneProjectionYear) => boolean,
): { year: number; age: number } | null {
  const hit = years.find((y) => y.year > asOfYear && test(y));
  return hit ? { year: hit.year, age: hit.age } : null;
}

/** Savings-rate targets are round numbers: a rate that rounds (to a whole
 *  percent) to the target meets it — 24.9% meets 25%. Every savings-rate
 *  threshold check goes through this, so the dashboard and Milestones agree. */
export function meetsRateTarget(rate: number, target: number): boolean {
  const scale = 10 ** (2 + SAVINGS_RATE_DECIMALS);
  return Math.round(rate * scale) >= Math.round(target * scale);
}

/** Money Guy's 25%, as a round number. */
export function meetsMoneyGuyRate(rate: number): boolean {
  return meetsRateTarget(rate, MONEY_GUY_SAVINGS_RATE);
}

/** A target set in one year's dollars, in another year's dollars. */
export function inflateTarget(
  amount: number,
  fromYear: number,
  toYear: number,
  inflationRate: number,
): number {
  return amount * Math.pow(1 + inflationRate, toYear - fromYear);
}

/**
 * The year the projection crosses the FI number. The FI number is in today's
 * dollars and the projection is nominal, so the number grows with inflation
 * each year — comparing today's-dollar expenses with a nominal balance would
 * call FI years early.
 */
export function projectedFiYear(
  years: readonly MilestoneProjectionYear[],
  fiTargetToday: number,
  inflationRate: number,
  asOfYear: number,
): { year: number; age: number } | null {
  if (fiTargetToday <= 0) return null;
  return firstProjectedYear(
    years,
    asOfYear,
    (y) =>
      y.liquid >= inflateTarget(fiTargetToday, asOfYear, y.year, inflationRate),
  );
}

/** Config for a stored account-type key; null for sub-types and unknown keys. */
function configOf(key: string) {
  return getAllCategories().includes(key as AccountCategory)
    ? getAccountTypeConfig(key as AccountCategory)
    : null;
}

const multiple = (n: number) => `${formatNumber(n, 1)}×`;

function definition(id: BuiltInMilestoneId): MilestoneDefinition {
  return MILESTONE_BY_ID[id];
}

function result(
  id: BuiltInMilestoneId,
  fields: Partial<MilestoneResult> &
    Pick<MilestoneResult, "status" | "headline">,
): MilestoneResult {
  return {
    ...definition(id),
    alert: false,
    value: null,
    target: null,
    progress: null,
    note: null,
    nextStep: null,
    reachedYear: null,
    expectedYear: null,
    expectedAge: null,
    achievements: [],
    impact: null,
    ...fields,
    short: fields.short ?? fields.headline,
  };
}

function reachedNote(
  reachedYear: number,
  years: readonly MilestoneYear[],
  stillMet: boolean,
): string {
  const firstOnRecord = years[0]?.year === reachedYear;
  const when = firstOnRecord
    ? `By ${reachedYear} (first year on record)`
    : `Reached ${reachedYear}`;
  return stillMet ? when : `${when} · currently below`;
}

function expectedNote(
  expected: { year: number; age: number } | null,
  input: MilestoneInput,
  estimate = false,
): string | null {
  if (!input.projection) return null;
  if (!expected) return "Not reached in the projection";
  const prefix = estimate ? "About" : "On pace for";
  const scenario = input.projection.isScenario ? " (scenario)" : "";
  return `${prefix} ${expected.year} · age ${Math.round(expected.age)}${scenario}`;
}

/**
 * A "reach this amount" milestone: reached when any year met it (and says so
 * if it has since dipped below), otherwise on track when the projection gets
 * there, behind when it doesn't.
 */
function amountMilestone(
  id: BuiltInMilestoneId,
  input: MilestoneInput,
  opts: {
    current: number;
    target: number;
    history: (y: MilestoneYear) => number;
    projected: ((y: MilestoneProjectionYear) => number) | null;
    estimate?: boolean;
  },
): MilestoneResult {
  const { current, target } = opts;
  const reachedYear = firstReachedYear(
    input.years,
    (y) => opts.history(y) >= target,
  );
  const value: MilestoneValue = { kind: "currency", amount: current };
  const targetValue: MilestoneValue = { kind: "currency", amount: target };
  const headline = `${formatCurrency(current)} of ${formatCurrency(target)}`;
  if (reachedYear !== null) {
    return result(id, {
      status: "reached",
      value,
      target: targetValue,
      progress: 1,
      headline,
      reachedYear,
      note: reachedNote(reachedYear, input.years, current >= target),
      achievements: [{ year: reachedYear, label: definition(id).title }],
    });
  }
  const project = opts.projected;
  const expected =
    input.projection && project
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) => project(y) >= target,
        )
      : null;
  return result(id, {
    status:
      !input.projection || !project
        ? "unknown"
        : expected
          ? "onTrack"
          : "behind",
    value,
    target: targetValue,
    progress: Math.max(0, Math.min(1, safeDivide(current, target, 0))),
    headline,
    note: project ? expectedNote(expected, input, opts.estimate) : null,
    nextStep: `${formatCurrency(target - current)} to go`,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
  });
}

// ---------------------------------------------------------------------------
// Wealth journey
// ---------------------------------------------------------------------------

function journey(input: MilestoneInput, now: MilestoneYear): MilestoneResult[] {
  const nonLiquid = now.netWorth - now.liquid;
  const out: MilestoneResult[] = [];

  out.push(
    amountMilestone("zero", input, {
      current: now.netWorth,
      target: 0,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("first100k", input, {
      current: now.liquid,
      target: FIRST_100K,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  // Investments save harder than you: growth at the napkin rate vs a year
  // of saving (incl. employer money).
  {
    const growth = now.liquid * MONEY_GUY_NAPKIN_RETURN;
    const saving = input.savings?.savedWithMatch ?? null;
    const reachedYear = firstReachedYear(
      input.years,
      (y) =>
        y.contributions !== null &&
        y.contributions > 0 &&
        y.liquid * MONEY_GUY_NAPKIN_RETURN >= y.contributions,
      false,
    );
    const metNow = saving !== null && saving > 0 && growth >= saving;
    const firstYear = reachedYear ?? (metNow ? input.asOfYear : null);
    const expected =
      firstYear === null && input.projection
        ? firstProjectedYear(
            input.projection.years,
            input.asOfYear,
            (y) =>
              y.contributions !== null &&
              y.contributions > 0 &&
              y.liquid * MONEY_GUY_NAPKIN_RETURN >= y.contributions,
          )
        : null;
    out.push(
      result("investmentsSaveHarder", {
        status:
          firstYear !== null
            ? "reached"
            : saving === null
              ? "unknown"
              : !input.projection
                ? "unknown"
                : expected
                  ? "onTrack"
                  : "behind",
        value: { kind: "currency", amount: growth },
        target: saving !== null ? { kind: "currency", amount: saving } : null,
        progress:
          saving && saving > 0
            ? Math.min(1, safeDivide(growth, saving, 0))
            : null,
        headline:
          saving !== null
            ? `${formatCurrency(growth)} growth vs ${formatCurrency(saving)} saved a year`
            : `${formatCurrency(growth)} growth a year`,
        reachedYear: firstYear,
        note:
          firstYear !== null
            ? reachedNote(firstYear, input.years, metNow || saving === null)
            : expectedNote(expected, input),
        nextStep:
          firstYear === null && saving !== null
            ? `At ${formatCurrency(safeDivide(saving, MONEY_GUY_NAPKIN_RETURN, 0))} invested, growth matches what you save`
            : null,
        expectedYear: expected?.year ?? null,
        expectedAge: expected?.age ?? null,
        achievements:
          firstYear !== null
            ? [
                {
                  year: firstYear,
                  label: definition("investmentsSaveHarder").title,
                },
              ]
            : [],
      }),
    );
  }

  out.push(
    amountMilestone("twoComma", input, {
      current: now.netWorth,
      target: ONE_MILLION,
      history: (y) => y.netWorth,
      projected: (y) => y.liquid + nonLiquid,
      estimate: true,
    }),
  );
  out.push(
    amountMilestone("liquidMillionaire", input, {
      current: now.liquid,
      target: ONE_MILLION,
      history: (y) => y.liquid,
      projected: (y) => y.liquid,
    }),
  );

  // Money works harder than you: growth at the napkin rate vs gross pay.
  {
    const growth = now.liquid * MONEY_GUY_NAPKIN_RETURN;
    const pay = now.grossIncome;
    const reachedYear = firstReachedYear(
      input.years,
      (y) =>
        y.grossIncome > 0 &&
        y.liquid * MONEY_GUY_NAPKIN_RETURN >= y.grossIncome,
      false,
    );
    const metNow = pay > 0 && growth >= pay;
    const firstYear = reachedYear ?? (metNow ? input.asOfYear : null);
    const expected =
      firstYear === null && input.projection
        ? firstProjectedYear(
            input.projection.years,
            input.asOfYear,
            (y) =>
              y.salary !== null &&
              y.salary > 0 &&
              y.liquid * MONEY_GUY_NAPKIN_RETURN >= y.salary,
          )
        : null;
    out.push(
      result("moneyWorksHarder", {
        status:
          firstYear !== null
            ? "reached"
            : pay <= 0
              ? "unknown"
              : !input.projection
                ? "unknown"
                : expected
                  ? "onTrack"
                  : "behind",
        value: { kind: "currency", amount: growth },
        target: pay > 0 ? { kind: "currency", amount: pay } : null,
        progress: pay > 0 ? Math.min(1, safeDivide(growth, pay, 0)) : null,
        headline:
          pay > 0
            ? `${formatCurrency(growth)} growth vs ${formatCurrency(pay)} pay`
            : `${formatCurrency(growth)} growth a year`,
        reachedYear: firstYear,
        note:
          firstYear !== null
            ? reachedNote(firstYear, input.years, metNow || pay <= 0)
            : expectedNote(expected, input),
        nextStep:
          firstYear === null && pay > 0
            ? `At ${formatCurrency(safeDivide(pay, MONEY_GUY_NAPKIN_RETURN, 0))} invested, growth matches your pay`
            : null,
        expectedYear: expected?.year ?? null,
        expectedAge: expected?.age ?? null,
        achievements:
          firstYear !== null
            ? [{ year: firstYear, label: definition("moneyWorksHarder").title }]
            : [],
      }),
    );
  }

  out.push(fi(input, now));
  return out;
}

function fi(input: MilestoneInput, now: MilestoneYear): MilestoneResult {
  if (input.fiTarget <= 0) {
    return result("fi", {
      status: "unknown",
      headline: "Set a budget and withdrawal rate to get an FI number",
    });
  }
  // FI is a state, not a one-time step: it counts as reached only while
  // today's figure is there. The first year it was reached stays on the
  // timeline either way.
  const reachedYear = firstReachedYear(input.years, (y) => y.fiProgress >= 1);
  const achievements =
    reachedYear !== null
      ? [{ year: reachedYear, label: definition("fi").title }]
      : [];
  const value: MilestoneValue = { kind: "percent", amount: now.fiProgress };
  const headline = `${formatPercent(now.fiProgress)} of ${formatCurrency(input.fiTarget)}`;
  if (now.fiProgress >= 1) {
    return result("fi", {
      status: "reached",
      value,
      progress: 1,
      headline,
      short: "FI reached",
      reachedYear,
      note:
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, true)
          : null,
      achievements,
    });
  }
  const expected = input.projection
    ? projectedFiYear(
        input.projection.years,
        input.fiTarget,
        input.projection.inflationRate,
        input.asOfYear,
      )
    : null;
  return result("fi", {
    status: !input.projection ? "unknown" : expected ? "onTrack" : "behind",
    alert: Boolean(input.projection) && !expected,
    value,
    progress: Math.max(0, Math.min(1, now.fiProgress)),
    headline,
    short: !input.projection
      ? `${formatPercent(now.fiProgress)} there`
      : expected
        ? `On pace for age ${Math.round(expected.age)}`
        : "Not reached in projection",
    note:
      [
        reachedYear !== null
          ? reachedNote(reachedYear, input.years, false)
          : null,
        expectedNote(expected, input),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    nextStep: `${formatCurrency(Math.max(0, input.fiTarget - now.liquid))} to go in today's dollars`,
    reachedYear,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
    achievements,
  });
}

// ---------------------------------------------------------------------------
// Wealth
// ---------------------------------------------------------------------------

function wealthFormula(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const score = now.wealthScore;
  if (now.grossIncome <= 0 || now.age <= 0) {
    return result("wealthFormula", {
      status: "unknown",
      headline: "Needs income and birth dates",
    });
  }
  const tier = wealthScoreTier(score);
  const reachedYear = firstReachedYear(
    input.years,
    (y) => y.wealthScore >= WEALTH_TIER_PAW_MIN,
  );
  const expectedNetWorth = safeDivide(now.netWorth, score, 0);
  const pawNetWorth = expectedNetWorth * WEALTH_FORMULA_MULTIPLIER;
  return result("wealthFormula", {
    status: tier.tier === "paw" ? "reached" : score >= 1 ? "onTrack" : "behind",
    alert: tier.tier === "uaw",
    value: { kind: "multiple", amount: score },
    target: { kind: "multiple", amount: WEALTH_TIER_PAW_MIN },
    progress: Math.max(0, Math.min(1, score / WEALTH_TIER_PAW_MIN)),
    headline: `${multiple(score)} · ${tier.label}`,
    short: tier.shortLabel,
    reachedYear,
    note:
      reachedYear !== null
        ? reachedNote(reachedYear, input.years, tier.tier === "paw")
        : null,
    nextStep:
      tier.tier !== "paw" && expectedNetWorth > 0
        ? `PAW at ${formatCurrency(pawNetWorth)} net worth — ${formatCurrency(Math.max(0, pawNetWorth - now.netWorth))} to go`
        : null,
    achievements:
      reachedYear !== null
        ? [{ year: reachedYear, label: "Prodigious Accumulator" }]
        : [],
  });
}

function checkpoints(
  id: "moneyGuyCheckpoints" | "fidelityCheckpoints",
  table: readonly IncomeCheckpoint[],
  input: MilestoneInput,
  now: MilestoneYear,
  balance: (y: MilestoneYear) => number,
): MilestoneResult {
  if (now.grossIncome <= 0 || now.age <= 0) {
    return result(id, {
      status: "unknown",
      headline: "Needs income and birth dates",
    });
  }
  const ratio = (y: MilestoneYear) =>
    y.grossIncome > 0 ? balance(y) / y.grossIncome : 0;
  const current = ratio(now);
  const target = incomeMultipleTarget(table, now.age);
  const achievements = table.flatMap((cp) => {
    const year = firstReachedYear(input.years, (y) => ratio(y) >= cp.multiple);
    return year !== null
      ? [
          {
            year,
            label: `${multiple(cp.multiple)} income${id === "fidelityCheckpoints" ? " (Fidelity)" : ""}`,
          },
        ]
      : [];
  });
  const last = table[table.length - 1]!;
  const next = table.find((cp) => current < cp.multiple) ?? null;
  // Projected liquid ÷ projected pay — the Money Guy table only (the
  // projection doesn't carry a retirement-accounts-only balance).
  const expected =
    next && id === "moneyGuyCheckpoints" && input.projection
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) =>
            y.salary !== null &&
            y.salary > 0 &&
            y.liquid / y.salary >= next.multiple,
        )
      : null;
  const highest = achievements[achievements.length - 1] ?? null;
  const notes = [
    highest ? `${highest.label} reached ${highest.year}` : null,
    next
      ? `next ${multiple(next.multiple)} by ${next.age}${
          expected ? ` — on pace for age ${Math.round(expected.age)}` : ""
        }`
      : null,
  ].filter(Boolean);
  return result(id, {
    status:
      current >= last.multiple
        ? "reached"
        : current >= target
          ? "onTrack"
          : "behind",
    value: { kind: "multiple", amount: current },
    target: { kind: "multiple", amount: target },
    progress: target > 0 ? Math.min(1, current / target) : 1,
    headline: `${multiple(current)} of ${multiple(target)} for age ${Math.round(now.age)}`,
    note: notes.length ? notes.join(" · ") : null,
    nextStep:
      current < target
        ? `${formatCurrency((target - current) * now.grossIncome)} more to be on pace for your age`
        : null,
    impact:
      current < target
        ? { kind: "oneTime", amount: (target - current) * now.grossIncome }
        : null,
    reachedYear: highest?.year ?? null,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
    achievements,
  });
}

// ---------------------------------------------------------------------------
// Saving, FOO, safety, home, investing
// ---------------------------------------------------------------------------

function savingsRate(input: MilestoneInput): MilestoneResult {
  const s = input.savings;
  if (!s || s.compensation <= 0) {
    return result("savingsRate", {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  const met = meetsMoneyGuyRate(s.rate);
  const gapPerMonth = (MONEY_GUY_SAVINGS_RATE * s.compensation - s.saved) / 12;
  return result("savingsRate", {
    status: met ? "reached" : "behind",
    value: { kind: "percent", amount: s.rate },
    target: { kind: "percent", amount: MONEY_GUY_SAVINGS_RATE },
    progress: Math.min(1, s.rate / MONEY_GUY_SAVINGS_RATE),
    headline: `${formatSavingsRate(s.rate)} of gross pay`,
    note: [
      s.retirementRate < s.rate
        ? `${formatSavingsRate(s.retirementRate)} into Retirement accounts`
        : null,
      s.matchCounted
        ? "employer match counted"
        : `employer match left out (pay over ${formatCurrency(s.highIncomeThreshold)})`,
    ]
      .filter(Boolean)
      .join(" · "),
    nextStep: met
      ? null
      : `${formatCurrency(gapPerMonth)} more a month reaches 25%`,
    impact: met ? null : { kind: "perYear", amount: gapPerMonth * 12 },
  });
}

function emergencyFund(
  id: "emergencyFund" | "foo4",
  input: MilestoneInput,
): MilestoneResult {
  const months = input.efundMonths;
  if (months === null) {
    return result(id, {
      status: "unknown",
      headline: "Set up an emergency fund goal",
    });
  }
  const met = months >= EMERGENCY_FUND_MONTHS.min;
  return result(id, {
    status: met ? "reached" : "behind",
    alert: months < EMERGENCY_FUND_MONTHS.alertBelow,
    value: { kind: "months", amount: months },
    target: { kind: "months", amount: EMERGENCY_FUND_MONTHS.min },
    progress: Math.min(1, months / EMERGENCY_FUND_MONTHS.full),
    headline: `${formatNumber(months, 1)} months covered`,
    short: `${formatNumber(months, 1)} mo covered`,
    note:
      met && months < EMERGENCY_FUND_MONTHS.full
        ? `${EMERGENCY_FUND_MONTHS.full} months is fully stocked`
        : null,
    nextStep: met
      ? null
      : `Build to ${EMERGENCY_FUND_MONTHS.min} months of essential expenses`,
  });
}

function limitStep(
  id: "foo5" | "foo6",
  input: MilestoneInput,
): MilestoneResult {
  const step = id === "foo5" ? 5 : 6;
  if (!input.limits) {
    return result(id, {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  // Step 5: the IRA and HSA. Step 6: every limit in the Retirement parent
  // category, employee money only (employer money only where the IRS
  // limit itself counts it, e.g. HSA).
  const rows = input.limits.filter((l) =>
    step === 5 ? l.fooStep5 : l.retirement,
  );
  if (rows.some((l) => l.limit <= 0)) {
    return result(id, {
      status: "unknown",
      headline: "This year's IRS limits aren't entered",
      nextStep: "Add them under Settings → IRS Limits",
    });
  }
  if (rows.length === 0) {
    // Money Guy: skip step 5 without an HSA-eligible plan or a way into a
    // Roth IRA — Ledgr can't see eligibility, so it can't call this behind.
    return step === 5
      ? result(id, {
          status: "unknown",
          headline: "No IRA or HSA set up",
          nextStep:
            "Open a Roth IRA if you can (a backdoor Roth works above the income limit); the HSA needs a high-deductible health plan",
        })
      : result(id, {
          status: "unknown",
          headline: "No retirement accounts with an IRS limit",
        });
  }
  const contributed = rows.reduce(
    (s, r) => s + Math.min(r.contributed, r.limit),
    0,
  );
  const limit = rows.reduce((s, r) => s + r.limit, 0);
  const open = rows.filter(
    (r) => r.contributed < r.limit * LIMIT_FILLED_TOLERANCE,
  );
  // Money Guy's step 6: reaching a 25% retirement investing rate (the
  // Retirement category only — Portfolio money is step 7's) before the
  // plans are maxed also completes the step. (Their "if you don't have a
  // high income" has no number; the high-income threshold only decides
  // whether the match counts toward the 25%.)
  const unlimitedNote =
    step === 6 && (input.retirementUnlimited ?? 0) > 0
      ? `Plus ${formatCurrency(input.retirementUnlimited!)} a year into retirement accounts without an IRS limit`
      : null;
  const s = input.savings;
  const twentyFiveFirst =
    step === 6 &&
    open.length > 0 &&
    s !== null &&
    meetsMoneyGuyRate(s.retirementRate);
  if (twentyFiveFirst) {
    return result(id, {
      status: "reached",
      value: { kind: "currency", amount: contributed },
      target: { kind: "currency", amount: limit },
      progress: 1,
      headline: `Investing ${formatSavingsRate(s.retirementRate)} for retirement before maxing out`,
      note: [
        `${formatCurrency(contributed)} of ${formatCurrency(limit)} a year of IRS limits`,
        unlimitedNote,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return result(id, {
    status: open.length === 0 ? "reached" : "behind",
    value: { kind: "currency", amount: contributed },
    target: { kind: "currency", amount: limit },
    progress: Math.min(1, safeDivide(contributed, limit, 0)),
    headline: `${formatCurrency(contributed)} of ${formatCurrency(limit)} a year`,
    note: unlimitedNote,
    impact: open.length
      ? {
          kind: "perYear",
          amount: open.reduce((sum, r) => sum + (r.limit - r.contributed), 0),
        }
      : null,
    nextStep: open.length
      ? open
          .map(
            (r) =>
              `${r.owner} ${r.label}: ${formatCurrency(r.limit - r.contributed)} of room`,
          )
          .join(" · ")
      : null,
  });
}

function foo(
  input: MilestoneInput,
  now: MilestoneYear,
  savings: MilestoneResult,
  efund: MilestoneResult,
): MilestoneResult[] {
  const ticked = (k: MilestoneChecklistItem) => input.checklist[k] === true;
  const out: MilestoneResult[] = [];

  out.push(
    ticked("deductibles")
      ? result("foo1", { status: "reached", headline: "Covered" })
      : result("foo1", {
          status: "unknown",
          headline: "Not ticked yet",
          nextStep: "Tick it below once cash covers your deductibles",
        }),
  );

  const m = input.match;
  if (!m) {
    out.push(
      result("foo2", {
        status: "unknown",
        headline: "Needs a paycheck set up",
      }),
    );
  } else if (m.available <= 0) {
    out.push(
      result("foo2", {
        status: "reached",
        headline: "No employer match offered",
      }),
    );
  } else {
    const left = Math.max(0, m.available - m.captured);
    out.push(
      result("foo2", {
        status: left < 1 ? "reached" : "behind",
        alert: left >= 1,
        value: { kind: "currency", amount: m.captured },
        target: { kind: "currency", amount: m.available },
        progress: Math.min(1, safeDivide(m.captured, m.available, 0)),
        headline:
          left < 1
            ? `Full match: ${formatCurrency(m.captured)} a year`
            : `${formatCurrency(m.captured)} of ${formatCurrency(m.available)} a year`,
        short:
          left < 1
            ? `${formatCurrency(m.captured)}/yr captured`
            : `${formatCurrency(left)}/yr missed`,
        nextStep:
          left >= 1
            ? `${formatCurrency(left)} a year of match left on the table — raise the 401k contribution`
            : null,
        impact: left >= 1 ? { kind: "perYear", amount: left } : null,
      }),
    );
  }

  out.push(
    now.otherLiabilities <= 0
      ? result("foo3", {
          status: "reached",
          headline: "No debt besides the mortgage",
        })
      : result("foo3", {
          status: "unknown",
          headline: `${formatCurrency(now.otherLiabilities)} of other debt`,
          note: "Includes credit-card balances — Ledgr can't tell what's paid in full each month or what the rates are",
          nextStep:
            "Pay off any card balance you carry, and loans above Money Guy's age line",
        }),
  );

  out.push({ ...efund, ...definition("foo4"), id: "foo4" });
  out.push(limitStep("foo5", input));
  out.push(limitStep("foo6", input));
  out.push({ ...savings, ...definition("foo7"), id: "foo7" });

  out.push(
    ticked("prepaid")
      ? result("foo8", { status: "reached", headline: "Saving ahead" })
      : result("foo8", {
          status: "unknown",
          headline: "Not ticked yet",
          nextStep:
            "Tick it below once you're saving ahead for big known costs",
        }),
  );

  const payoffYear = input.mortgage?.payoffYear ?? null;
  if (!owesMortgage(input, now) && now.otherLiabilities <= 0) {
    out.push(result("foo9", { status: "reached", headline: "Debt-free" }));
  } else if (owesMortgage(input, now)) {
    out.push(
      result("foo9", {
        status: "onTrack",
        headline: payoffYear
          ? `Mortgage paid off ${payoffYear}`
          : "Mortgage in progress",
        expectedYear: payoffYear,
      }),
    );
  } else {
    out.push(
      result("foo9", { status: "unknown", headline: "Other debt in progress" }),
    );
  }
  return out;
}

/** A mortgage is still owed: the active loan, or a balance in this year's
 *  figures when the loan details aren't available. */
function owesMortgage(input: MilestoneInput, now: MilestoneYear): boolean {
  return Boolean(input.mortgage?.active) || now.mortgageBalance > 0;
}

function protection(
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const items: MilestoneChecklistItem[] = [
    "will",
    "termLife",
    "healthDirective",
  ];
  const done = items.filter((k) => input.checklist[k] === true).length;
  return result("protection", {
    status:
      done === items.length
        ? "reached"
        : now.age < PROTECTION_CHECKLIST_AGE
          ? "onTrack"
          : "behind",
    value: { kind: "count", amount: done },
    target: { kind: "count", amount: items.length },
    progress: done / items.length,
    headline: `${done} of ${items.length} done`,
    nextStep:
      done < items.length
        ? items
            .filter((k) => input.checklist[k] !== true)
            .map((k) => MILESTONE_CHECKLIST_ITEMS[k])
            .join(" · ")
        : null,
  });
}

function housing(input: MilestoneInput, now: MilestoneYear): MilestoneResult[] {
  const mortgage = input.mortgage;
  const out: MilestoneResult[] = [];
  const monthlyPay = now.grossIncome / 12;
  if (!mortgage?.active || monthlyPay <= 0) {
    out.push(
      result("housing", {
        status: "unknown",
        headline: mortgage?.active ? "Needs income" : "No mortgage on file",
      }),
    );
  } else {
    const share = mortgage.monthlyHousingCost / monthlyPay;
    out.push(
      result("housing", {
        status:
          share <= HOUSING_COST_SHARE.max
            ? "reached"
            : share <= HOUSING_COST_SHARE.stretch
              ? "onTrack"
              : "behind",
        value: { kind: "percent", amount: share },
        target: { kind: "percent", amount: HOUSING_COST_SHARE.max },
        headline: `${formatPercent(share, 1)} of gross pay (${formatCurrency(mortgage.monthlyHousingCost)}/mo)`,
        note:
          share > HOUSING_COST_SHARE.max && share <= HOUSING_COST_SHARE.stretch
            ? "Over 25%, within Money Guy's high-cost-area allowance"
            : null,
        nextStep:
          share > HOUSING_COST_SHARE.max
            ? "Raises bring this under 25% over time"
            : null,
      }),
    );
  }

  if (!owesMortgage(input, now)) {
    const hadMortgage = input.years.some((y) => y.mortgageBalance > 0);
    let paidYear: number | null = null;
    for (let i = 1; i < input.years.length; i++) {
      if (
        input.years[i - 1]!.mortgageBalance > 0 &&
        input.years[i]!.mortgageBalance <= 0
      )
        paidYear = input.years[i]!.year;
    }
    out.push(
      hadMortgage || mortgage
        ? result("paidOffHome", {
            status: "reached",
            headline: "Paid off",
            reachedYear: paidYear,
            note: paidYear ? `Paid off ${paidYear}` : null,
            achievements: paidYear
              ? [{ year: paidYear, label: "Mortgage paid off" }]
              : [],
          })
        : result("paidOffHome", {
            status: "unknown",
            headline: "No mortgage on file",
          }),
    );
  } else {
    const payoffYear = mortgage?.payoffYear ?? null;
    const payoffAge =
      payoffYear !== null ? now.age + (payoffYear - input.asOfYear) : null;
    out.push(
      result("paidOffHome", {
        status:
          payoffAge === null
            ? "unknown"
            : payoffAge <= PAID_OFF_HOME_BY_AGE
              ? "onTrack"
              : "behind",
        headline: payoffYear
          ? `Paid off ${payoffYear} · age ${Math.round(payoffAge ?? 0)}`
          : "Payoff date unknown",
        expectedYear: payoffYear,
        expectedAge: payoffAge,
        nextStep:
          payoffAge !== null && payoffAge > PAID_OFF_HOME_BY_AGE
            ? `${Math.ceil(payoffAge - PAID_OFF_HOME_BY_AGE)} years past 60 — extra principal or investments that could pay it off both count`
            : null,
      }),
    );
  }
  return out;
}

function investing(input: MilestoneInput): MilestoneResult[] {
  const h = input.holdings;
  const notLinked = "Not enough linked holdings";
  if (!h) {
    return [
      result("rebalance", { status: "unknown", headline: notLinked }),
      result("lowCost", { status: "unknown", headline: notLinked }),
    ];
  }
  const out: MilestoneResult[] = [];
  const targeted = h.classes.filter((c) => c.targetShare !== null);
  if (h.coverage < HOLDINGS_MIN_COVERAGE || targeted.length === 0) {
    out.push(
      result("rebalance", {
        status: "unknown",
        headline:
          targeted.length === 0 ? "No target allocation set" : notLinked,
      }),
    );
  } else {
    const off = targeted.filter((c) => {
      const gap = Math.abs(c.share - c.targetShare!);
      return (
        gap > REBALANCE_BANDS.absolute ||
        (c.targetShare! >= REBALANCE_BANDS.relativeMinTarget &&
          gap > REBALANCE_BANDS.relative * c.targetShare!)
      );
    });
    // The bands decide when; the targets decide what: once any class is
    // outside its band, every class moves back to its target (Bogleheads
    // rebalance to the target mix, not just the class that tripped).
    const dollars = (c: (typeof targeted)[number]) =>
      Math.abs(c.share - c.targetShare!) * h.knownValue;
    const moves = off.length
      ? targeted.filter(
          (c) => Math.abs(c.share - c.targetShare!) >= REBALANCE_BANDS.minMove,
        )
      : [];
    const over = moves
      .filter((c) => c.share > c.targetShare!)
      .sort((a, b) => dollars(b) - dollars(a));
    const under = moves
      .filter((c) => c.share < c.targetShare!)
      .sort((a, b) => dollars(b) - dollars(a));
    const list = (cs: typeof targeted) =>
      cs.map((c) => `${compactCurrency(dollars(c))} into ${c.name}`).join(", ");
    const names = (cs: typeof targeted) => cs.map((c) => c.name).join(" and ");
    const overTotal = over.reduce((s, c) => s + dollars(c), 0);
    const underTotal = under.reduce((s, c) => s + dollars(c), 0);
    const action =
      over.length && under.length
        ? `Move about ${compactCurrency(overTotal)} out of ${names(over)} — ${list(under)}`
        : over.length
          ? `Move about ${compactCurrency(overTotal)} out of ${names(over)} into what's under target`
          : under.length
            ? `Add about ${compactCurrency(underTotal)} — ${list(under)}`
            : null;
    const gaps = off
      .map((c) => {
        const gap = c.share - c.targetShare!;
        return `${c.name} ${formatNumber(Math.abs(gap) * 100, 1)} pts ${gap > 0 ? "over" : "under"}`;
      })
      .join(" · ");
    out.push(
      result("rebalance", {
        status: off.length === 0 ? "reached" : "behind",
        headline:
          off.length === 0
            ? "Every class within its band"
            : `${off.length} class${off.length === 1 ? "" : "es"} outside the band: ${gaps}`,
        note:
          h.unlinkedValue > 0
            ? `${formatCurrency(h.unlinkedValue)} of holdings aren't linked to an asset class and aren't counted — link them on Benchmarks`
            : null,
        nextStep: action,
        impact:
          action !== null
            ? { kind: "oneTime", amount: Math.max(overTotal, underTotal) }
            : null,
      }),
    );
  }
  if (h.expenseRatio === null || h.costCoverage < HOLDINGS_MIN_COVERAGE) {
    out.push(result("lowCost", { status: "unknown", headline: notLinked }));
  } else {
    const low = h.expenseRatio <= LOW_COST_EXPENSE_RATIO;
    out.push(
      result("lowCost", {
        status: low ? "reached" : "behind",
        value: { kind: "percent", amount: h.expenseRatio },
        target: { kind: "percent", amount: LOW_COST_EXPENSE_RATIO },
        headline: `${formatPercent(h.expenseRatio, 2)} blended expense ratio`,
        nextStep: low
          ? null
          : "Look for index funds with lower expense ratios on the Benchmarks page",
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// r/personalfinance
// ---------------------------------------------------------------------------

function pfRetirementRate(input: MilestoneInput): MilestoneResult {
  const s = input.savings;
  if (!s || s.compensation <= 0) {
    return result("pfRetirementRate", {
      status: "unknown",
      headline: "Needs a paycheck set up",
    });
  }
  const met = meetsRateTarget(s.retirementRate, PF_RETIREMENT_RATE.min);
  const upper = meetsRateTarget(s.retirementRate, PF_RETIREMENT_RATE.upper);
  const gapPerMonth =
    ((PF_RETIREMENT_RATE.min - s.retirementRate) * s.compensation) / 12;
  return result("pfRetirementRate", {
    status: met ? "reached" : "behind",
    value: { kind: "percent", amount: s.retirementRate },
    target: { kind: "percent", amount: PF_RETIREMENT_RATE.min },
    progress: Math.min(1, s.retirementRate / PF_RETIREMENT_RATE.min),
    headline: `${formatSavingsRate(s.retirementRate)} of pre-tax income into Retirement accounts`,
    note: [
      upper
        ? `At or above the ${formatSavingsRate(PF_RETIREMENT_RATE.upper)} upper end`
        : `${formatSavingsRate(PF_RETIREMENT_RATE.upper)} is the upper end`,
      s.matchCounted
        ? "employer match counted"
        : `employer match left out (pay over ${formatCurrency(s.highIncomeThreshold)})`,
    ].join(" · "),
    nextStep: met
      ? null
      : `${formatCurrency(gapPerMonth)} more a month into retirement accounts reaches 15%`,
    impact: met ? null : { kind: "perYear", amount: gapPerMonth * 12 },
  });
}

function megaBackdoor(input: MilestoneInput): MilestoneResult {
  const rows = input.megaBackdoor;
  if (!rows || rows.length === 0) {
    return result("megaBackdoor", {
      status: "unknown",
      headline: "No workplace plan set up",
    });
  }
  const room = rows.reduce((sum, r) => sum + r.room, 0);
  return result("megaBackdoor", {
    // Ledgr can't see whether a plan takes after-tax money, so this is
    // information, not a grade.
    status: "unknown",
    value: { kind: "currency", amount: room },
    headline: `Up to ${formatCurrency(room)} a year of after-tax room`,
    short: `${formatCurrency(room)}/yr room`,
    note: "If your plan allows after-tax contributions · assumes one employer plan each, before any profit-sharing",
    nextStep: rows
      .map(
        (r) =>
          `${r.owner}: ${formatCurrency(r.room)} of the ${formatCurrency(r.limit)} limit left`,
      )
      .join(" · "),
  });
}

function goalHorizon(input: MilestoneInput): MilestoneResult {
  const goals = input.brokerageGoals;
  if (!goals || goals.length === 0) {
    return result("goalHorizon", {
      status: "unknown",
      headline: "No brokerage goals",
    });
  }
  const yearsOut = (g: { targetYear: number }) => g.targetYear - input.asOfYear;
  const soon = goals.filter((g) => yearsOut(g) <= GOAL_HORIZON_YEARS.cash);
  const mid = goals.filter(
    (g) =>
      yearsOut(g) > GOAL_HORIZON_YEARS.cash &&
      yearsOut(g) <= GOAL_HORIZON_YEARS.conservative,
  );
  const list = (gs: typeof goals) =>
    gs.map((g) => `${g.name} (${g.targetYear})`).join(", ");
  if (soon.length > 0) {
    return result("goalHorizon", {
      status: "behind",
      headline: `${soon.length} brokerage goal${soon.length === 1 ? "" : "s"} due within ${GOAL_HORIZON_YEARS.cash} years`,
      nextStep: `Move toward savings, CDs or I bonds: ${list(soon)}`,
      note: mid.length ? `Conservative mix for: ${list(mid)}` : null,
    });
  }
  return result("goalHorizon", {
    status: mid.length ? "onTrack" : "reached",
    headline: mid.length
      ? `${mid.length} goal${mid.length === 1 ? "" : "s"} ${GOAL_HORIZON_YEARS.cash}–${GOAL_HORIZON_YEARS.conservative} years out`
      : `Every brokerage goal is ${GOAL_HORIZON_YEARS.conservative}+ years out`,
    nextStep: mid.length
      ? `A conservative stock/bond mix for: ${list(mid)}`
      : null,
  });
}

function fundCosts(input: MilestoneInput): MilestoneResult {
  const funds = input.holdings?.funds ?? [];
  const judged = funds.filter((f) => f.bucket in PF_FUND_EXPENSE_RATIO);
  if (judged.length === 0) {
    return result("fundCosts", {
      status: "unknown",
      headline: "Not enough linked holdings",
    });
  }
  const bar = (f: (typeof judged)[number]) =>
    PF_FUND_EXPENSE_RATIO[f.bucket as keyof typeof PF_FUND_EXPENSE_RATIO];
  const pricey = judged.filter((f) => f.expenseRatio > bar(f));
  return result("fundCosts", {
    status: pricey.length ? "behind" : "reached",
    value: { kind: "count", amount: judged.length - pricey.length },
    target: { kind: "count", amount: judged.length },
    progress: (judged.length - pricey.length) / judged.length,
    headline: pricey.length
      ? `${pricey.length} of ${judged.length} funds over the bar`
      : `All ${judged.length} funds under the bar`,
    nextStep: pricey.length
      ? pricey
          .map(
            (f) =>
              `${f.name} ${formatPercent(f.expenseRatio, 2)} (${COMPOSITION_BUCKET_LABELS[f.bucket]}: under ${formatPercent(bar(f), 2)})`,
          )
          .join(" · ")
      : null,
  });
}

// ---------------------------------------------------------------------------
// Custom goals
// ---------------------------------------------------------------------------

function customGoalValue(metric: CustomGoalMetric, y: MilestoneYear): number {
  switch (metric) {
    case "netWorth":
      return y.netWorth;
    case "liquid":
      return y.liquid;
    case "retirement":
      return y.retirement;
    case "brokerage":
      return y.brokerage;
  }
}

function customGoal(
  goal: CustomGoal,
  input: MilestoneInput,
  now: MilestoneYear,
): MilestoneResult {
  const inflation = input.projection?.inflationRate ?? 0;
  const targetIn = (year: number) =>
    goal.todaysDollars
      ? inflateTarget(goal.target, goal.setYear, year, inflation)
      : goal.target;
  const current = customGoalValue(goal.metric, now);
  const targetNow = targetIn(input.asOfYear);
  const reachedYear = firstReachedYear(
    input.years,
    (y) => customGoalValue(goal.metric, y) >= targetIn(y.year),
  );
  const nonLiquid = now.netWorth - now.liquid;
  const projected =
    goal.metric === "liquid"
      ? (y: MilestoneProjectionYear) => y.liquid
      : goal.metric === "netWorth"
        ? (y: MilestoneProjectionYear) => y.liquid + nonLiquid
        : null;
  const expected =
    reachedYear === null && projected && input.projection
      ? firstProjectedYear(
          input.projection.years,
          input.asOfYear,
          (y) => projected(y) >= targetIn(y.year),
        )
      : null;
  const def: MilestoneDefinition = {
    id: `custom:${goal.id}`,
    group: "custom",
    source: "custom",
    title: goal.label,
    rule: `${CUSTOM_GOAL_METRICS[goal.metric]} of ${formatCurrency(goal.target)}${
      goal.todaysDollars ? ` in ${goal.setYear} dollars` : ""
    }.`,
    href: "/milestones",
  };
  const headline = `${formatCurrency(current)} of ${formatCurrency(targetNow)}`;
  const base = {
    ...def,
    alert: false,
    value: { kind: "currency", amount: current } as MilestoneValue,
    target: { kind: "currency", amount: targetNow } as MilestoneValue,
    headline,
    short: headline,
    expectedYear: expected?.year ?? null,
    expectedAge: expected?.age ?? null,
  };
  if (reachedYear !== null) {
    return {
      ...base,
      status: "reached",
      progress: 1,
      note: reachedNote(reachedYear, input.years, current >= targetNow),
      nextStep: null,
      impact: null,
      reachedYear,
      achievements: [{ year: reachedYear, label: goal.label }],
    };
  }
  return {
    ...base,
    status:
      !projected || !input.projection
        ? "unknown"
        : expected
          ? "onTrack"
          : "behind",
    progress: Math.max(0, Math.min(1, safeDivide(current, targetNow, 0))),
    note: projected
      ? expectedNote(expected, input, goal.metric === "netWorth")
      : null,
    nextStep: `${formatCurrency(Math.max(0, targetNow - current))} to go`,
    impact: { kind: "oneTime", amount: Math.max(0, targetNow - current) },
    reachedYear: null,
    achievements: [],
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Judge every milestone. Empty when there's no history yet. */
export function evaluateMilestones(input: MilestoneInput): MilestoneResult[] {
  const now = input.years[input.years.length - 1];
  if (!now) return [];
  const savings = savingsRate(input);
  const efund = emergencyFund("emergencyFund", input);
  return [
    ...journey(input, now),
    ...input.customGoals.map((g) => customGoal(g, input, now)),
    ...foo(input, now, savings, efund),
    wealthFormula(input, now),
    input.checkpointSource === "moneyGuy"
      ? checkpoints(
          "moneyGuyCheckpoints",
          MONEY_GUY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("moneyGuy", y),
        )
      : checkpoints(
          "fidelityCheckpoints",
          FIDELITY_CHECKPOINTS,
          input,
          now,
          (y) => checkpointBalance("fidelity", y),
        ),
    input.savingsTargetSource === "personalFinance"
      ? pfRetirementRate(input)
      : savings,
    megaBackdoor(input),
    goalHorizon(input),
    efund,
    protection(input, now),
    ...housing(input, now),
    ...investing(input),
    fundCosts(input),
  ];
}

/** The FOO step you're on: the first one not reached and not waiting on
 *  information. Null once every judged step is done. */
export function currentFooStep(
  results: readonly MilestoneResult[],
): number | null {
  for (let step = 1; step <= 9; step++) {
    const r = results.find((x) => x.id === `foo${step}`);
    if (r && r.status === "behind") return step;
  }
  return null;
}

/** Reached milestones in date order. */
export function milestoneTimeline(
  results: readonly MilestoneResult[],
): { year: number; label: string; id: string }[] {
  return results
    .flatMap((r) => r.achievements.map((a) => ({ ...a, id: r.id })))
    .sort((a, b) => a.year - b.year || a.label.localeCompare(b.label));
}

/** The unreached milestones you're closest to (journey, your goals, wealth). */
export function nextUpMilestones(
  results: readonly MilestoneResult[],
  count = 2,
): MilestoneResult[] {
  return results
    .filter(
      (r) =>
        (r.group === "journey" ||
          r.group === "custom" ||
          r.group === "wealth") &&
        r.status !== "reached" &&
        r.progress !== null &&
        r.progress < 1,
    )
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .slice(0, count);
}

/** Last finalized year next to now, for the "since last year" line. */
export function sinceLastYear(years: readonly MilestoneYear[]): {
  fromYear: number;
  netWorth: [number, number];
  liquidMultiple: [number, number] | null;
  wealthScore: [number, number];
} | null {
  const now = years[years.length - 1];
  const before = [...years].reverse().find((y) => !y.isCurrent && y !== now);
  if (!now || !before) return null;
  const mult = (y: MilestoneYear) =>
    y.grossIncome > 0 ? y.liquid / y.grossIncome : null;
  const a = mult(before);
  const b = mult(now);
  return {
    fromYear: before.year,
    netWorth: [before.netWorth, now.netWorth],
    liquidMultiple: a !== null && b !== null ? [a, b] : null,
    wealthScore: [before.wealthScore, now.wealthScore],
  };
}

// ---------------------------------------------------------------------------
// Input builders (pure mappings from what the app already computes)
// ---------------------------------------------------------------------------

/** A year-end history row → the milestones' view of it. Retirement vs
 *  brokerage follows each account's own parent category (the tax-location
 *  breakdown); rows without one fall back to the account-type config. */
export function milestoneYearFromHistory(row: {
  year: number;
  isCurrent: boolean;
  averageAge: number;
  netWorthMarket: number;
  portfolioTotal: number;
  portfolioByType: Record<string, number>;
  portfolioByTaxLocation: {
    retirement: Record<string, number>;
    portfolio: Record<string, number>;
  } | null;
  cash: number;
  /** The year's gross income — wealthFormulaIncome(row), not averaged. */
  grossIncome: number;
  perfContributions: number | null;
  perfEmployerMatch: number | null;
  aawScoreMarket: number;
  fiProgress: number;
  mortgageBalance: number;
  otherLiabilities: number;
}): MilestoneYear {
  const sum = (r: Record<string, number>) =>
    Object.values(r).reduce((s, v) => s + v, 0);
  let retirement = 0;
  if (row.portfolioByTaxLocation) {
    retirement = sum(row.portfolioByTaxLocation.retirement);
  } else {
    for (const [type, amount] of Object.entries(row.portfolioByType)) {
      const config = configOf(type);
      if (config && isRetirementParent(config.parentCategory))
        retirement += amount;
    }
  }
  return {
    year: row.year,
    isCurrent: row.isCurrent,
    age: row.averageAge,
    netWorth: row.netWorthMarket,
    liquid: row.portfolioTotal + row.cash,
    cash: row.cash,
    retirement,
    brokerage: Math.max(0, row.portfolioTotal - retirement),
    grossIncome: row.grossIncome,
    contributions:
      !row.isCurrent && row.perfContributions !== null
        ? row.perfContributions + (row.perfEmployerMatch ?? 0)
        : null,
    wealthScore: row.aawScoreMarket,
    fiProgress: row.fiProgress,
    mortgageBalance: row.mortgageBalance,
    otherLiabilities: row.otherLiabilities,
  };
}

/** Projection years → the milestones' view (today's cash held flat). */
export function milestoneProjectionYears(
  years: readonly {
    year: number;
    age: number;
    phase: string;
    endBalance: number;
    projectedSalary?: number;
    totalEmployee?: number;
    totalEmployer?: number;
  }[],
  cashToday: number,
): MilestoneProjectionYear[] {
  return years.map((y) => {
    const working = y.phase === "accumulation";
    return {
      year: y.year,
      age: y.age,
      liquid: y.endBalance + cashToday,
      salary: working ? (y.projectedSalary ?? 0) : null,
      contributions: working
        ? (y.totalEmployee ?? 0) + (y.totalEmployer ?? 0)
        : null,
    };
  });
}

type LimitAccount = {
  categoryKey: string;
  accountType: string;
  /** The account's own parent category (Retirement / Portfolio). */
  parentCategory: string;
  limit: number;
  employeeContrib: number;
  totalContrib: number;
};

/**
 * Contributions vs IRS limits, one row per person per limit group (401k and
 * 403b share one limit), household-wide groups (family HSA) counted once.
 * Employee money only, unless the IRS limit itself counts employer money
 * (config `matchCountsTowardLimit`, e.g. HSA). A row is "retirement" when
 * any of its accounts sits in the Retirement parent category.
 */
export function milestoneLimits(
  people: readonly { name: string; accountTypes: readonly LimitAccount[] }[],
  joint: readonly LimitAccount[],
): MilestoneLimit[] {
  const rows = new Map<string, MilestoneLimit>();
  const add = (owner: string, a: LimitAccount) => {
    const config = configOf(a.categoryKey);
    // A limited account with no limit found (the year's IRS limits not
    // entered yet) stays in as limit 0 — judged "not enough data", never
    // silently dropped.
    if (!config || !config.irsLimitGroup) return;
    const who = config.isHouseholdLimit ? "Household" : owner;
    const key = `${who}|${config.irsLimitGroup}`;
    const contributed = config.matchCountsTowardLimit
      ? a.totalContrib
      : a.employeeContrib;
    const retirement = isRetirementParent(a.parentCategory);
    const existing = rows.get(key);
    if (existing) {
      existing.contributed += contributed;
      existing.limit = Math.max(existing.limit, a.limit);
      existing.retirement ||= retirement;
    } else {
      rows.set(key, {
        fooStep5: config.fooStep === 5,
        retirement,
        owner: who,
        label: config.displayLabel,
        contributed,
        limit: a.limit,
      });
    }
  };
  for (const p of people) for (const a of p.accountTypes) add(p.name, a);
  for (const a of joint) add("Household", a);
  return [...rows.values()];
}

/** A year's employee contributions to Retirement-category accounts with no
 *  IRS limit (e.g. a brokerage account set aside for retirement). */
export function retirementUnlimitedContributions(
  accounts: readonly LimitAccount[],
): number {
  return accounts
    .filter((a) => {
      if (!isRetirementParent(a.parentCategory)) return false;
      const config = configOf(a.categoryKey);
      return !config?.irsLimitGroup;
    })
    .reduce((sum, a) => sum + a.employeeContrib, 0);
}

/** Bogleheads view of the linked holdings: class shares of the money whose
 *  mix is known (the Benchmarks page's denominator) vs glide-path targets. */
export function milestoneHoldings(overview: {
  allocation: {
    total: number;
    unknown: number;
    rows: { name: string; value: number; targetPct: number | null }[];
    unmapped?: { value: number }[];
  };
  cost: { expenseRatio: number | null; coveredShare: number };
  accounts?: {
    holdings: {
      securityId: number | null;
      name: string | null;
      symbol: string | null;
      facts: {
        expenseRatio: { value: number } | null;
        composition: { buckets: Record<CompositionBucket, number> } | null;
      };
    }[];
  }[];
}): MilestoneInput["holdings"] {
  const { total, unknown, rows } = overview.allocation;
  if (total <= 0) return null;
  const known = total - unknown;
  // Each fund once (it can sit in several accounts), by its main category.
  const funds = new Map<
    string,
    { name: string; bucket: CompositionBucket; expenseRatio: number }
  >();
  for (const a of overview.accounts ?? [])
    for (const h of a.holdings) {
      const er = h.facts.expenseRatio?.value;
      const buckets = h.facts.composition?.buckets;
      if (er == null || !buckets) continue;
      const main = (
        Object.entries(buckets) as [CompositionBucket, number][]
      ).find(([, share]) => share >= FUND_MAIN_BUCKET_SHARE);
      if (!main) continue;
      const key = String(h.securityId ?? h.symbol ?? h.name);
      funds.set(key, {
        name: h.symbol ?? h.name ?? "A fund",
        bucket: main[0],
        expenseRatio: er,
      });
    }
  return {
    coverage: safeDivide(known, total, 0),
    knownValue: known,
    unlinkedValue: (overview.allocation.unmapped ?? []).reduce(
      (sum, u) => sum + u.value,
      0,
    ),
    classes: rows.map((r) => ({
      name: r.name,
      share: safeDivide(r.value, known, 0),
      targetShare: r.targetPct,
    })),
    expenseRatio: overview.cost.expenseRatio,
    costCoverage: overview.cost.coveredShare,
    funds: [...funds.values()],
  };
}

/**
 * After-tax ("mega backdoor") room per person in plans with an IRS
 * total-additions limit (config `irsLimitKeys.totalAdditions`): the lesser
 * of that limit and the person's pay, less employee deferrals up to the
 * base limit (catch-up doesn't count) and the employer match. Assumes one
 * employer plan per person (each unrelated employer has its own limit) and
 * no profit-sharing contributions (not modelled).
 */
export function megaBackdoorRoom(
  people: readonly {
    name: string;
    /** The person's pay (salary + bonus) — 415(c) caps at 100% of it. */
    compensation: number;
    accountTypes: readonly {
      categoryKey: string;
      employeeContrib: number;
      employerMatch: number;
    }[];
  }[],
  limitsRecord: Record<string, number>,
): { owner: string; room: number; limit: number }[] {
  const out: { owner: string; room: number; limit: number }[] = [];
  for (const p of people) {
    let limit = 0;
    let base = 0;
    let employee = 0;
    let employer = 0;
    for (const a of p.accountTypes) {
      const keys = configOf(a.categoryKey)?.irsLimitKeys;
      if (!keys?.totalAdditions) continue;
      limit = limitsRecord[keys.totalAdditions] ?? 0;
      base = limitsRecord[keys.base] ?? 0;
      employee += a.employeeContrib;
      employer += a.employerMatch;
    }
    if (limit <= 0) continue;
    if (p.compensation > 0) limit = Math.min(limit, p.compensation);
    out.push({
      owner: p.name,
      room: Math.max(0, limit - Math.min(employee, base) - employer),
      limit,
    });
  }
  return out;
}

type MilestoneAccount = LimitAccount &
  SavingsRatePerson["accountTypes"][number] & {
    employerMatch: number;
    employerMatchAvailable: number;
  };

/**
 * Everything the app already computes → the engine's input. The one place
 * these figures are mapped, so the page and the dashboard card can't each
 * derive "liquid", the savings rate or housing cost their own way.
 */
export function buildMilestoneInput(raw: {
  inputs: {
    asOfYear: number;
    years: MilestoneYear[];
    fiTarget: number;
    customGoals: CustomGoal[];
    checklist: MilestoneChecklist;
    checkpointSource: CheckpointSource;
    savingsTargetSource: SavingsTargetSource;
  };
  contributions: {
    people: (Omit<SavingsRatePerson, "accountTypes"> & {
      person: { name: string };
      accountTypes: MilestoneAccount[];
    })[];
    jointAccountTypes: MilestoneAccount[];
    /** The year's IRS limits, by key. */
    limits?: Record<string, number>;
  } | null;
  highIncomeThreshold: number;
  brokerageGoals?: { name: string; targetYear: number }[] | null;
  efundMonths: number | null;
  mortgage: {
    loans: {
      id: number;
      principalAndInterest: string | number;
      pmi: string | number;
      insuranceAndTaxes: string | number;
    }[];
    activeLoanId: number | null;
    activeLoanResult: {
      remainingMonths: number;
      payoffDate: Date | string;
    } | null;
  } | null;
  projection: {
    projectionByYear: Parameters<typeof milestoneProjectionYears>[0];
    annualInflation: number;
    isScenario: boolean;
  } | null;
  holdings: Parameters<typeof milestoneHoldings>[0] | null;
}): MilestoneInput {
  const { inputs } = raw;
  const now = inputs.years[inputs.years.length - 1];
  const cashToday = now?.cash ?? 0;

  let savings: MilestoneInput["savings"] = null;
  let match: MilestoneInput["match"] = null;
  let limits: MilestoneInput["limits"] = null;
  let retirementUnlimited: MilestoneInput["retirementUnlimited"] = null;
  let mega: MilestoneInput["megaBackdoor"] = null;
  const c = raw.contributions;
  const people = c?.people.filter((p) => p.accountTypes.length > 0) ?? [];
  if (c && people.length > 0) {
    // Money Guy's definitions, fixed — not the per-viewer display switches,
    // on the full year's plan, the match counted below the high-income
    // threshold. The 25% rule (step 7) counts Retirement and Portfolio
    // money alike; step 6's "25% before maxing out" is the Retirement
    // category alone.
    const highIncome = isHighIncomeHousehold(
      householdTotalCompensation(people),
      raw.highIncomeThreshold,
    );
    const breakdown = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      { excludeMatch: highIncome, includePortfolio: true },
    );
    const retirementOnly = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      { excludeMatch: highIncome, includePortfolio: false },
    );
    const withMatch = householdSavings(
      people,
      c.jointAccountTypes,
      "projected",
      {
        excludeMatch: false,
        includePortfolio: true,
      },
    );
    savings = {
      rate: breakdown.rate,
      retirementRate: retirementOnly.rate,
      saved: breakdown.total,
      savedWithMatch: withMatch.total,
      compensation: breakdown.compensation,
      matchCounted: !highIncome,
      highIncome,
      highIncomeThreshold: raw.highIncomeThreshold,
      breakdown,
    };
    const accounts = [
      ...people.flatMap((p) => p.accountTypes),
      ...c.jointAccountTypes,
    ];
    match = {
      captured: accounts.reduce((sum, a) => sum + a.employerMatch, 0),
      available: accounts.reduce(
        (sum, a) => sum + Math.max(a.employerMatch, a.employerMatchAvailable),
        0,
      ),
    };
    retirementUnlimited = retirementUnlimitedContributions(accounts);
    mega = c.limits
      ? megaBackdoorRoom(
          people.map((p) => ({
            name: p.person.name,
            compensation: p.totalCompensation ?? p.salary ?? 0,
            accountTypes: p.accountTypes,
          })),
          c.limits,
        )
      : null;
    limits = milestoneLimits(
      people.map((p) => ({
        name: p.person.name,
        accountTypes: p.accountTypes,
      })),
      c.jointAccountTypes,
    );
  }

  let mortgage: MilestoneInput["mortgage"] = null;
  const m = raw.mortgage;
  if (m) {
    const loan = m.loans.find((l) => l.id === m.activeLoanId);
    const active = Boolean(
      loan && m.activeLoanResult && m.activeLoanResult.remainingMonths > 0,
    );
    mortgage = {
      active,
      monthlyHousingCost: loan
        ? Number(loan.principalAndInterest) +
          Number(loan.pmi) +
          Number(loan.insuranceAndTaxes)
        : 0,
      payoffYear:
        active && m.activeLoanResult
          ? new Date(m.activeLoanResult.payoffDate).getFullYear()
          : null,
    };
  }

  // Years before the household's records start (all zeros) say nothing —
  // left in, "net worth ≥ $0" would read as reached the first empty year.
  const years = inputs.years.filter(
    (y) =>
      y.isCurrent || y.netWorth !== 0 || y.liquid !== 0 || y.grossIncome !== 0,
  );
  return {
    asOfYear: inputs.asOfYear,
    years,
    projection: raw.projection
      ? {
          years: milestoneProjectionYears(
            raw.projection.projectionByYear,
            cashToday,
          ),
          inflationRate: raw.projection.annualInflation,
          isScenario: raw.projection.isScenario,
        }
      : null,
    fiTarget: inputs.fiTarget,
    savings,
    match,
    limits,
    retirementUnlimited,
    efundMonths: raw.efundMonths,
    mortgage,
    holdings: raw.holdings ? milestoneHoldings(raw.holdings) : null,
    checklist: inputs.checklist,
    customGoals: inputs.customGoals,
    checkpointSource: inputs.checkpointSource,
    savingsTargetSource: inputs.savingsTargetSource,
    megaBackdoor: mega,
    brokerageGoals: raw.brokerageGoals ?? null,
  };
}
