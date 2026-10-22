/**
 * Milestones — the registry of financial rules and milestones the Milestones
 * page, the dashboard Financial Checkup and the Retirement card's readiness
 * row all judge through `evaluateMilestones()` (lib/pure/milestones.ts).
 *
 * Every threshold lives here, once. Rules come from The Money Guy Show (their
 * adapted versions — `adaptedNote` says how they differ from the original
 * source), the Bogleheads, Fidelity and The Millionaire Next Door.
 */

export type MilestoneSource =
  | "moneyGuy"
  | "personalFinance"
  | "bogleheads"
  | "fidelity"
  | "millionaireNextDoor"
  | "custom";

export const MILESTONE_SOURCE_LABELS: Record<MilestoneSource, string> = {
  moneyGuy: "Money Guy",
  personalFinance: "r/personalfinance",
  bogleheads: "Bogleheads",
  fidelity: "Fidelity",
  millionaireNextDoor: "Millionaire Next Door",
  custom: "Your goal",
};

export type MilestoneGroup =
  | "journey"
  | "custom"
  | "wealth"
  | "saving"
  | "foo"
  | "safety"
  | "housing"
  | "investing";

export const MILESTONE_GROUPS: {
  key: MilestoneGroup;
  title: string;
  blurb: string;
}[] = [
  {
    key: "journey",
    title: "Wealth journey",
    blurb: "The Money Guy Show's seven milestones, from zero to independence.",
  },
  {
    key: "custom",
    title: "Your goals",
    blurb: "Targets you set yourself.",
  },
  {
    key: "foo",
    title: "Financial Order of Operations",
    blurb: "Where the next dollar goes, in order.",
  },
  {
    key: "wealth",
    title: "Wealth",
    blurb: "How your wealth compares with your age and income.",
  },
  { key: "saving", title: "Saving", blurb: "How much of your pay you keep." },
  {
    key: "safety",
    title: "Safety",
    blurb: "Cash and protection for the unexpected.",
  },
  { key: "housing", title: "Home", blurb: "Keeping the house affordable." },
  {
    key: "investing",
    title: "Investing",
    blurb: "Bogleheads basics, from your linked holdings.",
  },
];

export type MilestoneDefinition = {
  id: string;
  group: MilestoneGroup;
  source: MilestoneSource;
  title: string;
  /** The rule in one line. */
  rule: string;
  /** How The Money Guy Show's version differs from the original source. */
  adaptedNote?: string;
  /** Where you act on it. */
  href: string;
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Money Guy's napkin-math return for "investments save / work harder". */
export const MONEY_GUY_NAPKIN_RETURN = 0.08;
export const FIRST_100K = 100_000;
export const ONE_MILLION = 1_000_000;

/** A multiple of gross income by an age; linear between checkpoints. */
export type IncomeCheckpoint = { age: number; multiple: number };

/** The age the income-multiple glide starts from (0× — first full-time pay). */
export const CHECKPOINT_START_AGE = 22;

/** Money Guy: liquid investments (retirement + brokerage + HSA + cash, no
 *  home or business) as a multiple of gross income. 20× at 65 = 80% income
 *  replacement × 25 (the 4% rule). */
export const MONEY_GUY_CHECKPOINTS: readonly IncomeCheckpoint[] = [
  { age: 30, multiple: 1 },
  { age: 40, multiple: 3 },
  { age: 50, multiple: 6.4 },
  { age: 60, multiple: 13.7 },
  { age: 65, multiple: 20 },
];

/** Fidelity: retirement savings only, as a multiple of salary. */
export const FIDELITY_CHECKPOINTS: readonly IncomeCheckpoint[] = [
  { age: 30, multiple: 1 },
  { age: 35, multiple: 2 },
  { age: 40, multiple: 3 },
  { age: 45, multiple: 4 },
  { age: 50, multiple: 6 },
  { age: 55, multiple: 7 },
  { age: 60, multiple: 8 },
  { age: 67, multiple: 10 },
];

/** The income-multiple table the household follows — the two disagree
 *  after 40 and measure different money, so only one is shown. */
export const CHECKPOINT_SOURCES = {
  moneyGuy: {
    label: "Money Guy",
    milestoneId: "moneyGuyCheckpoints",
    measures: "liquid investments",
  },
  fidelity: {
    label: "Fidelity",
    milestoneId: "fidelityCheckpoints",
    measures: "retirement savings",
  },
} as const;
export type CheckpointSource = keyof typeof CHECKPOINT_SOURCES;
export const DEFAULT_CHECKPOINT_SOURCE: CheckpointSource = "moneyGuy";

/** The savings-rate rule the household follows — Money Guy's 25% of gross
 *  (retirement and brokerage) or r/personalfinance's 15% (up to 20%) of
 *  pre-tax income into retirement accounts. One is shown. */
export const SAVINGS_TARGET_SOURCES = {
  moneyGuy: { label: "Money Guy 25%", milestoneId: "savingsRate" },
  personalFinance: {
    label: "r/personalfinance 15%",
    milestoneId: "pfRetirementRate",
  },
} as const;
export type SavingsTargetSource = keyof typeof SAVINGS_TARGET_SOURCES;
export const DEFAULT_SAVINGS_TARGET_SOURCE: SavingsTargetSource = "moneyGuy";

/** r/personalfinance: save at least 15%, up to 20%, of pre-tax income for
 *  retirement before other goals. */
export const PF_RETIREMENT_RATE = { min: 0.15, upper: 0.2 };

/** r/personalfinance: money for goals sooner than 3–5 years belongs in
 *  savings, CDs or I bonds — not stocks. */
export const GOAL_HORIZON_YEARS = { cash: 3, conservative: 5 };

/** r/personalfinance's bar for good index funds (their test for whether an
 *  employer plan beats an IRA): domestic stock under 0.1%, international
 *  stock under 0.2%, bonds under 0.1%. */
export const PF_FUND_EXPENSE_RATIO = {
  us_equity: 0.001,
  intl_equity: 0.002,
  us_bond: 0.001,
  intl_bond: 0.001,
  tips: 0.001,
} as const;
/** A fund's main category: the bucket holding at least this share. */
export const FUND_MAIN_BUCKET_SHARE = 0.6;

/** Money Guy's hyperaccumulation savings rate (of gross pay). */
export const MONEY_GUY_SAVINGS_RATE = 0.25;

/** Money Guy: the savings rate needed to retire comfortably, by the age you
 *  start saving. */
export const MONEY_GUY_STARTING_AGE_RATES: readonly {
  age: number;
  rate: number;
}[] = [
  { age: 20, rate: 0.06 },
  { age: 25, rate: 0.1 },
  { age: 30, rate: 0.17 },
  { age: 35, rate: 0.25 },
];

/** Months of essential expenses. Money Guy: 3–6 months by FOO step 4. */
export const EMERGENCY_FUND_MONTHS = { min: 3, full: 6, alertBelow: 1 };

/** Money Guy 3/5/25: housing costs under 25% of gross pay (up to ~30% is
 *  reasonable in a high-cost area). */
export const HOUSING_COST_SHARE = { max: 0.25, stretch: 0.3 };

/** Money Guy's 50s milestone: the house paid off (or able to be) by 60. */
export const PAID_OFF_HOME_BY_AGE = 60;

/** Money Guy's 40s "protect and plan" list. */
export const PROTECTION_CHECKLIST_AGE = 40;

/** Bogleheads 5/25 rebalancing bands: rebalance when an asset class is off
 *  its target by more than 5 percentage points or 25% of the target. */
export const REBALANCE_BANDS = {
  absolute: 0.05,
  relative: 0.25,
  /** The 25%-of-target band only for classes targeted at least this much —
   *  for a small class (a 1–2% cash target) 25% of it is a fraction of a
   *  point, so those are judged on the 5-point band alone. */
  relativeMinTarget: 0.05,
  /** Once a band is breached, every class goes back to its target; gaps
   *  smaller than this aren't worth a trade. */
  minMove: 0.005,
};

/** A blended expense ratio at or below this counts as low cost. */
export const LOW_COST_EXPENSE_RATIO = 0.002;

/** Holdings must cover at least this share of the portfolio to judge the
 *  investing milestones. */
export const HOLDINGS_MIN_COVERAGE = 0.75;

/** A limit counts as filled within this fraction (rounding, a final paycheck). */
export const LIMIT_FILLED_TOLERANCE = 0.99;

// ---------------------------------------------------------------------------
// Checklist (ticked by an admin) and custom goals
// ---------------------------------------------------------------------------

export const MILESTONE_CHECKLIST_ITEMS = {
  deductibles: "Cash covers our insurance deductibles",
  prepaid: "We're saving ahead for big known costs (college, cars, weddings)",
  will: "Wills are written",
  termLife: "Term life insurance is in place",
  healthDirective: "Health-care directives are signed",
} as const;

export type MilestoneChecklistItem = keyof typeof MILESTONE_CHECKLIST_ITEMS;

export const CUSTOM_GOAL_METRICS = {
  netWorth: "Net worth",
  liquid: "Liquid investments",
  retirement: "Retirement accounts",
  brokerage: "Brokerage accounts",
} as const;

export type CustomGoalMetric = keyof typeof CUSTOM_GOAL_METRICS;

export const MAX_CUSTOM_GOALS = 12;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const NAPKIN = "Money Guy's napkin math: 8% growth a year.";

export const MILESTONES = [
  // --- Wealth journey (Money Guy's 7) ---
  {
    id: "zero",
    group: "journey",
    source: "moneyGuy",
    title: "Reaching zero",
    rule: "Net worth of $0 or more — everything you own covers everything you owe.",
    href: "/networth",
  },
  {
    id: "first100k",
    group: "journey",
    source: "moneyGuy",
    title: "Your first $100k",
    rule: "$100,000 in liquid investments: retirement accounts, brokerage, HSA and cash.",
    href: "/portfolio",
  },
  {
    id: "investmentsSaveHarder",
    group: "journey",
    source: "moneyGuy",
    title: "Investments save harder than you",
    rule: `A year's growth on your investments is bigger than a year of saving. ${NAPKIN}`,
    adaptedNote:
      "A year of saving comes from your recorded contributions for past years, your paycheck plan for this year, and the retirement projection for future years.",
    href: "/portfolio",
  },
  {
    id: "twoComma",
    group: "journey",
    source: "moneyGuy",
    title: "Two Comma Club",
    rule: "$1 million net worth, home equity included.",
    href: "/networth",
  },
  {
    id: "liquidMillionaire",
    group: "journey",
    source: "moneyGuy",
    title: "Liquid millionaire",
    rule: "$1 million in liquid investments — the home doesn't count.",
    href: "/portfolio",
  },
  {
    id: "moneyWorksHarder",
    group: "journey",
    source: "moneyGuy",
    title: "Money works harder than you",
    rule: `A year's growth on your investments is bigger than your gross pay. ${NAPKIN}`,
    href: "/portfolio",
  },
  {
    id: "fi",
    group: "journey",
    source: "moneyGuy",
    title: "Financial independence",
    rule: "Your liquid net worth reaches your FI number (yearly expenses ÷ your withdrawal rate). It counts all your investments — retirement and other — plus cash.",
    adaptedNote:
      "Money Guy confirms FI with a stress test, not the 4% rule alone — check the Retirement page's simulation too.",
    href: "/retirement",
  },

  // --- Financial Order of Operations ---
  {
    id: "foo1",
    group: "foo",
    source: "moneyGuy",
    title: "1 · Deductibles covered",
    rule: "Enough cash to pay your highest insurance deductibles.",
    href: "/savings",
  },
  {
    id: "foo2",
    group: "foo",
    source: "moneyGuy",
    title: "2 · Employer match",
    rule: "Contribute enough to get every dollar of the employer match.",
    href: "/paycheck",
  },
  {
    id: "foo3",
    group: "foo",
    source: "moneyGuy",
    title: "3 · High-interest debt",
    rule: "Pay off credit cards and high-rate loans.",
    adaptedNote:
      "Money Guy's line moves with age: student loans above 6% in your 20s, 5% in your 30s, 4% in your 40s; car loans above 10% / 9% / 8%; any credit card balance.",
    href: "/liabilities",
  },
  {
    id: "foo4",
    group: "foo",
    source: "moneyGuy",
    title: "4 · Emergency reserves",
    rule: "3–6 months of expenses in cash.",
    href: "/savings",
  },
  {
    id: "foo5",
    group: "foo",
    source: "moneyGuy",
    title: "5 · Roth IRA & HSA",
    rule: "Fill the IRA and HSA to their IRS limits.",
    adaptedNote:
      "Money Guy: skip it without a high-deductible health plan (no HSA) or a way to fund a Roth IRA.",
    href: "/paycheck",
  },
  {
    id: "foo6",
    group: "foo",
    source: "moneyGuy",
    title: "6 · Max out retirement",
    rule: "Fill the IRS limit of every account in the Retirement category (401k/403b, IRA, HSA) with your own contributions — or reach 25% of gross pay into Retirement accounts first (Portfolio money is step 7's).",
    adaptedNote:
      "Money Guy's step 6 is the employer plans; Ledgr counts every account you've put in the Retirement category, so step 5's IRA and HSA are part of it. Employer match isn't counted — the IRS limit is for your own deferrals (an HSA's limit includes employer money). Money Guy says hitting 25% before maxing out is enough to move on \"if you don't have a high income\" but gives no number; Ledgr's high-income threshold only decides whether the match counts toward the 25%.",
    href: "/paycheck",
  },
  {
    id: "foo7",
    group: "foo",
    source: "moneyGuy",
    title: "7 · Hyperaccumulation",
    rule: "Save and invest 25% of gross pay, brokerage included.",
    href: "/contributions",
  },
  {
    id: "foo8",
    group: "foo",
    source: "moneyGuy",
    title: "8 · Prepaid future expenses",
    rule: "Save ahead for big costs you can see coming — college, the next car.",
    href: "/savings",
  },
  {
    id: "foo9",
    group: "foo",
    source: "moneyGuy",
    title: "9 · Low-interest debt",
    rule: "Only now pay extra on low-rate debt like the mortgage.",
    href: "/mortgage",
  },

  // --- Wealth ---
  {
    id: "wealthFormula",
    group: "wealth",
    source: "moneyGuy",
    title: "Prodigious Accumulator of Wealth",
    rule: "Net worth at least 2× (age × gross income) ÷ (10 + years until 40).",
    adaptedNote:
      "The Millionaire Next Door's original is age × income ÷ 10. Money Guy adds the years-until-40 so the formula works for people in their 20s and 30s. Under ½ is an Under Accumulator.",
    href: "/networth",
  },
  {
    id: "moneyGuyCheckpoints",
    group: "wealth",
    source: "moneyGuy",
    title: "Income-multiple checkpoints",
    rule: "Liquid investments of 1× gross income by 30, 3× by 40, 6.4× by 50, 13.7× by 60 and 20× at 65.",
    adaptedNote:
      "Money Guy keeps Fidelity's 1× and 3×, then raises the bar (Fidelity: 6× at 50, 10× at 67) and counts all liquid investments, not just retirement accounts.",
    href: "/portfolio",
  },
  {
    id: "fidelityCheckpoints",
    group: "wealth",
    source: "fidelity",
    title: "Fidelity savings targets",
    rule: "Retirement savings of 1× salary by 30, 3× by 40, 6× by 50, 8× by 60 and 10× at 67.",
    href: "/retirement",
  },

  // --- Saving ---
  {
    id: "savingsRate",
    group: "saving",
    source: "moneyGuy",
    title: "25% savings rate",
    rule: "Save and invest 25% of gross pay — retirement accounts, HSA and brokerage alike (a rate that rounds to 25% counts). The employer match counts until household pay passes the high-income threshold.",
    adaptedNote:
      "Money set aside for a specific future cost (college, the next car) is step 8, not part of the 25%. Starting later needs more: 6% from age 20, 10% from 25, 17% from 30, about 25% from 35.",
    href: "/contributions",
  },
  {
    id: "pfRetirementRate",
    group: "saving",
    source: "personalFinance",
    title: "15% for retirement",
    rule: "Save at least 15%, up to 20%, of pre-tax income for retirement — the Retirement category — before saving for other goals.",
    adaptedNote:
      "If you're behind on retirement savings, save more than 15%; if you can't reach it yet, start with 10%.",
    href: "/contributions",
  },
  {
    id: "megaBackdoor",
    group: "saving",
    source: "personalFinance",
    title: "Mega backdoor Roth room",
    rule: "After the 401k is full, some plans take after-tax contributions up to the IRS total-additions limit (employee + employer + after-tax), converted to Roth.",
    adaptedNote:
      "Only if your plan allows after-tax contributions and in-plan Roth conversions or in-service withdrawals — ask HR. Catch-up contributions don't count toward the limit.",
    href: "/paycheck",
  },
  {
    id: "goalHorizon",
    group: "saving",
    source: "personalFinance",
    title: "Near-term goals out of stocks",
    rule: "Money for goals sooner than 3–5 years belongs in savings, CDs or I bonds; a conservative stock/bond mix only for goals further out.",
    href: "/brokerage",
  },

  // --- Safety ---
  {
    id: "emergencyFund",
    group: "safety",
    source: "moneyGuy",
    title: "Emergency fund",
    rule: "3–6 months of essential expenses in cash; 6 is fully stocked.",
    adaptedNote:
      "Money Guy suggests more with one income or a specialized job, and 12–18 months in retirement.",
    href: "/savings",
  },
  {
    id: "protection",
    group: "safety",
    source: "moneyGuy",
    title: "Protect and plan",
    rule: "Wills, term life insurance and health-care directives — Money Guy's 40s checklist.",
    href: "/milestones",
  },

  // --- Home ---
  {
    id: "housing",
    group: "housing",
    source: "moneyGuy",
    title: "Affordable home (3/5/25)",
    rule: "Housing costs under 25% of gross pay (3–5% down, stay 5+ years).",
    adaptedNote:
      "The traditional lender rule is 28% of gross pay with 20% down. Money Guy allows up to ~30% in a high-cost area.",
    href: "/mortgage",
  },
  {
    id: "paidOffHome",
    group: "housing",
    source: "moneyGuy",
    title: "Paid-off home by 60",
    rule: "The house paid off — or able to be — by the end of your 50s.",
    href: "/mortgage",
  },

  // --- Investing (Bogleheads) ---
  {
    id: "rebalance",
    group: "investing",
    source: "bogleheads",
    title: "Rebalancing (5/25 bands)",
    rule: "Each asset class within 5 points, or 25% of its target, of where you want it (the 25% band only for classes targeted at 5% or more).",
    adaptedNote:
      "Targets come from your target mix today on Benchmarks (or, until you set one, the retirement simulation's glide path) at your age. “Age in bonds” is the Bogleheads' classic starting point for the bond share.",
    href: "/benchmarks",
  },
  {
    id: "lowCost",
    group: "investing",
    source: "bogleheads",
    title: "Low cost",
    rule: "A blended expense ratio of 0.20% or less.",
    href: "/benchmarks",
  },
  {
    id: "fundCosts",
    group: "investing",
    source: "personalFinance",
    title: "Low-cost funds, fund by fund",
    rule: "Domestic stock index funds under 0.1%, international stock under 0.2%, bond funds under 0.1% — r/personalfinance's bar for a good 401k lineup.",
    href: "/benchmarks",
  },
] as const satisfies readonly MilestoneDefinition[];

export type BuiltInMilestoneId = (typeof MILESTONES)[number]["id"];

export const MILESTONE_BY_ID: Record<BuiltInMilestoneId, MilestoneDefinition> =
  Object.fromEntries(MILESTONES.map((m) => [m.id, m])) as Record<
    BuiltInMilestoneId,
    MilestoneDefinition
  >;

/** The milestone rows the dashboard Financial Checkup shows, with their
 *  short labels. (Its savings-rate row is the household's own switchable
 *  rate and sits after the debt row.) */
export const CHECKUP_MILESTONES = [
  { id: "emergencyFund", label: "Emergency Fund" },
  { id: "foo2", label: "Employer Match" },
  { id: "foo3", label: "High-Interest Debt" },
  { id: "wealthFormula", label: "Wealth Score" },
  { id: "fi", label: "FI Progress" },
] as const satisfies readonly { id: BuiltInMilestoneId; label: string }[];
