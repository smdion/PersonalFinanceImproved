// Central withdrawal-strategy configuration — the ONLY place strategy-specific
// knowledge lives. Everything else imports from here.
//
// Philosophy: Config declares, code executes.
// Nothing in the codebase knows what "Guyton-Klinger" is — it only knows how to
// process a strategy with properties like `paramFields` and `incomeSource`.
//
// References: Morningstar "State of Retirement Income: 2025"

import { DEFAULT_ENDOWMENT_ROLLING_YEARS } from "../constants";

// ---------------------------------------------------------------------------
// Param field descriptor — drives UI rendering
// ---------------------------------------------------------------------------

type ParamFieldType = "percent" | "number" | "boolean";

/** Analyzer lever — how adjusting this param affects retirement outcomes. */
type ParamLever = {
  /** Change to apply. Relative: -0.5 = halve current value.
   *  Absolute: -0.005 = subtract 0.5 percentage points. */
  delta: number;
  /** Whether delta is relative to current value or an absolute offset. */
  unit: "relative" | "absolute";
  /** Which outcome metric this lever primarily improves. */
  targets: readonly ("survival" | "smoothness")[];
};

type ParamField = {
  key: string;
  /** The retirement_settings column (Drizzle name) the value is stored in. */
  column: string;
  label: string;
  type: ParamFieldType;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
  /** Stored as a whole number; the API takes an integer within min–max. */
  integer?: true;
  /** The column may be null, which means this default. */
  nullable?: true;
  tooltip?: string;
  /** Fields sharing the same group render side-by-side as a visual pair. */
  group?: string;
  /** Analyzer lever config — when present, the analyzer tests adjusting this param. */
  lever?: ParamLever;
};

// ---------------------------------------------------------------------------
// Strategy config shape
// ---------------------------------------------------------------------------

/** How the strategy determines annual spending — drives UI visibility of budget/rate controls. */
type IncomeSource = "budget" | "rate" | "formula";

/** Strategy guide content — rendered by the Strategy Guide panel. */
type StrategyGuide = {
  /** How the strategy works (plain language). */
  how: string;
  /** Key strengths. */
  strengths: readonly string[];
  /** Key weaknesses. */
  weaknesses: readonly string[];
  /** Who this strategy is best for. */
  bestFor: string;
  /** What to expect from the Stability metric for this strategy. */
  stabilityNote: string;
};

type WithdrawalStrategyConfig = {
  /** Display name for UI dropdown. */
  label: string;
  /** Abbreviated label for chart legends. */
  shortLabel: string;
  /** One-line explanation. */
  description: string;
  /** Morningstar paper citation. */
  morningstarRef: string | null;
  /** How spending is determined:
   *  - "budget": retirement budget is the primary input (rate is informational)
   *  - "rate": withdrawal rate × portfolio drives spending (budget is starting point)
   *  - "formula": spending computed from portfolio via IRS/endowment formula (budget and rate not used) */
  incomeSource: IncomeSource;
  /** Params the engine reads that no field edits, keyed by param name. */
  fixedParams?: Readonly<Record<string, number>>;
  /** UI-renderable parameter field descriptors. */
  paramFields: readonly ParamField[];
  /** Whether the strategy uses the user's Initial Withdrawal Rate setting. */
  usesWithdrawalRate: boolean;
  /** Whether the strategy uses the Post-Retirement Raise to grow expenses. */
  usesPostRetirementRaise: boolean;
  /** Whether this strategy's own reactive mechanism (guardrail triggers,
   *  loss-year detection) requires real year-to-year return VOLATILITY to
   *  ever activate — as opposed to reacting to something that moves
   *  smoothly on its own (current balance level, age-based IRS factor, a
   *  fixed decline schedule). The deterministic single-path projection
   *  uses one smooth average return with no volatility, so a strategy with
   *  this true will show a flat, uneventful deterministic Yearly Income
   *  Stability chart even though its Monte Carlo confidence band carries
   *  real signal — a real household found this confusing. Used to
   *  suppress the deterministic bars on that chart specifically for these
   *  strategies (see spending-stability-chart.tsx). */
  reactsToVolatility: boolean;
  /** Which SpendingCrossYearState fields this strategy reads/writes. */
  crossYearStateKeys: readonly string[];
  /** Strategy guide content for the flyout panel. */
  guide: StrategyGuide;
};

// ---------------------------------------------------------------------------
// THE CONFIG — one entry per withdrawal strategy
// ---------------------------------------------------------------------------

export const WITHDRAWAL_STRATEGY_CONFIG = {
  fixed: {
    label: "Fixed Real",
    shortLabel: "Fixed",
    description:
      "Inflation-adjusted constant withdrawal — the classic safe withdrawal rate approach",
    morningstarRef: "Base Case",
    incomeSource: "budget",
    usesWithdrawalRate: true,
    usesPostRetirementRaise: true,
    reactsToVolatility: false,
    paramFields: [],
    crossYearStateKeys: [],
    guide: {
      how: "Your first-year withdrawal is set by your retirement budget. Each subsequent year, that amount is adjusted upward by your post-retirement raise rate to maintain purchasing power.",
      strengths: [
        "Predictable, stable income — you know exactly what to expect each year",
        "Simple to understand and implement",
        "Spending stability tracks success rate (if the portfolio survives, income is maintained)",
      ],
      weaknesses: [
        "No feedback loop — spending ignores portfolio performance entirely",
        "In bad markets, you withdraw the same dollar amount from a shrinking portfolio, accelerating depletion",
        "In good markets, you leave money on the table (large unspent legacy)",
      ],
      bestFor:
        "Retirees who prioritize income certainty and set a Retirement budget that is a conservative share of the balance.",
      stabilityNote:
        "Stability ≈ success rate. If the portfolio survives, spending is always maintained.",
    },
  },

  forgo_inflation_after_loss: {
    label: "Forgo Inflation After Loss",
    shortLabel: "Forgo Infl.",
    description:
      "Skip inflation adjustment in years following a portfolio loss — cumulative real cuts",
    morningstarRef: "Method 1",
    incomeSource: "budget",
    usesWithdrawalRate: true,
    usesPostRetirementRaise: true,
    reactsToVolatility: true,
    paramFields: [],
    crossYearStateKeys: ["priorYearReturn", "initialWithdrawalAmount"],
    guide: {
      how: "Identical to Fixed Real, except: if the portfolio had a negative return last year, this year's spending stays flat (no inflation adjustment). This creates cumulative real spending cuts over time.",
      strengths: [
        "Simple, conservative tweak to Fixed Real",
        "Automatically reduces spending pressure after bad years",
        "Higher sustainable withdrawal rate than Fixed Real (~4.4% vs ~3.9%)",
      ],
      weaknesses: [
        'Skipped raises are permanent — spending never "catches up" after market recovery',
        "Multiple consecutive loss years compound the real spending cut",
        "Still no upside feedback — doesn't increase spending after strong gains",
      ],
      bestFor:
        "Retirees who want slightly higher initial spending with a modest safety valve.",
      stabilityNote:
        "Stability < success rate because skipped inflation years erode real spending. ~9+ cumulative loss years can push spending below the 75% threshold.",
    },
  },

  rmd_spending: {
    label: "RMD-Based Spending",
    shortLabel: "RMD",
    description:
      "Withdraw based on IRS Required Minimum Distribution factor, scaled by a multiplier",
    morningstarRef: "Method 2",
    incomeSource: "formula",
    usesWithdrawalRate: false,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    paramFields: [
      {
        key: "rmdMultiplier",
        column: "rmdMultiplier",
        label: "RMD Multiplier",
        type: "number",
        min: 0.5,
        max: 3.0,
        step: 0.1,
        default: 1.0,
        tooltip:
          "Multiplier applied to the IRS RMD amount. 1.0 = standard RMD.",
        lever: {
          delta: -0.2,
          unit: "relative",
          targets: ["survival", "smoothness"],
        },
      },
      {
        key: "ssInAmount",
        column: "rmdSsInAmount",
        label: "Social Security comes out of this amount",
        type: "boolean",
        nullable: true,
        default: false,
        tooltip:
          "Off (the method as published): the amount is what leaves the portfolio each year, and Social Security comes on top of it. On: the amount is your spending, and Social Security pays part of it — less leaves the portfolio once it starts.",
      },
    ],
    crossYearStateKeys: [],
    guide: {
      how: "Each year after RMD age (72–75), withdraw your portfolio balance divided by the IRS life expectancy factor, times an optional multiplier. Before RMD age, spending tracks your retirement budget with inflation.",
      strengths: [
        "Mathematically self-correcting — can never fully deplete the portfolio",
        "Spending naturally increases as time horizon shortens (higher % in later years)",
        "Backed by actuarial tables designed for lifetime distribution",
      ],
      weaknesses: [
        "Spending is volatile year-to-year (directly tied to portfolio balance)",
        "Early retirement gap — no RMD guidance before age 72, falls back to fixed spending",
        "Rising withdrawal percentages in very old age (10%+ at 95) may exceed needs",
      ],
      bestFor:
        "Retirees comfortable with variable income who want a rules-based, self-correcting approach.",
      stabilityNote:
        "Pre-RMD years track inflation closely. Post-RMD spending varies with portfolio performance, which reduces stability in volatile trials.",
    },
  },

  guyton_klinger: {
    label: "Guardrails (Guyton-Klinger)",
    shortLabel: "G-K",
    description:
      "Dynamic spending guardrails that increase or decrease withdrawals based on portfolio performance",
    morningstarRef: "Method 3",
    incomeSource: "rate",
    usesWithdrawalRate: true,
    usesPostRetirementRaise: true,
    reactsToVolatility: true,
    paramFields: [
      {
        key: "upperGuardrail",
        column: "gkUpperGuardrail",
        label: "Upper Guardrail",
        type: "percent",
        min: 0.5,
        max: 1.0,
        step: 0.01,
        default: 0.8,
        tooltip:
          "If current withdrawal rate drops below initial rate × this factor, increase spending (prosperity rule).",
        group: "prosperity",
      },
      {
        key: "increasePercent",
        column: "gkIncreasePct",
        label: "Increase %",
        type: "percent",
        min: 0.01,
        max: 0.3,
        step: 0.01,
        default: 0.1,
        tooltip:
          "Spending increase when upper guardrail triggers (portfolio outperforming).",
        group: "prosperity",
        lever: { delta: -0.5, unit: "relative", targets: ["survival"] },
      },
      {
        key: "lowerGuardrail",
        column: "gkLowerGuardrail",
        label: "Lower Guardrail",
        type: "percent",
        min: 1.0,
        max: 2.0,
        step: 0.01,
        default: 1.2,
        tooltip:
          "If current withdrawal rate exceeds initial rate × this factor, decrease spending (capital preservation rule).",
        group: "preservation",
      },
      {
        key: "decreasePercent",
        column: "gkDecreasePct",
        label: "Decrease %",
        type: "percent",
        min: 0.01,
        max: 0.3,
        step: 0.01,
        default: 0.1,
        tooltip:
          "Spending decrease when lower guardrail triggers (portfolio underperforming).",
        group: "preservation",
        lever: { delta: -0.5, unit: "relative", targets: ["smoothness"] },
      },
      {
        key: "skipInflationAfterLoss",
        column: "gkSkipInflationAfterLoss",
        label: "Skip Inflation After Loss",
        type: "boolean",
        default: true,
        tooltip:
          "Skip inflation adjustment in years following a portfolio loss (prosperity rule).",
      },
    ],
    crossYearStateKeys: [
      "initialWithdrawalRate",
      "priorYearReturn",
      "priorYearSpending",
      "priorYearSsIncome",
    ],
    guide: {
      how: "Start with your Retirement budget, raised by your Post-Retirement Raise each year. If your current withdrawal rate drops below 80% of the initial rate (portfolio doing well), increase spending 10%. If it exceeds 120% (portfolio struggling), cut spending 10%. Also skips inflation after loss years. The withdrawal rate is what the portfolio pays — spending less Social Security — over its balance, and the 10% moves are 10% of that draw; Social Security starting moves the starting rate with it, so it's never read as a market gain.",
      strengths: [
        "Strong portfolio protection — 100% success rate in most scenarios",
        "Responds to both good and bad markets with clear, rule-based adjustments",
        "Well-researched (Guyton & Klinger 2006, widely used by financial planners)",
      ],
      weaknesses: [
        "Spending cuts can compound — multiple 10% cuts stack multiplicatively",
        "Very conservative on the upside — massive portfolio growth may produce only modest spending increases",
        "The prosperity rule (skip inflation after loss) adds to real spending erosion",
        "Can leave very large unspent legacies while restricting current spending",
      ],
      bestFor:
        "Retirees who prioritize portfolio survival and accept variable income for safety.",
      stabilityNote:
        "Lower stability than Fixed/Forgo despite 100% success. The guardrail cuts and inflation skips erode real spending over time — the strategy sacrifices income stability for portfolio preservation.",
    },
  },

  spending_decline: {
    label: "Spending Decline",
    shortLabel: "Decline",
    description:
      "Annual real spending decline reflecting reduced consumption in later retirement (per EBRI data)",
    morningstarRef: "Method 4",
    incomeSource: "budget",
    usesWithdrawalRate: true,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    paramFields: [
      {
        key: "annualDeclineRate",
        column: "sdAnnualDeclineRate",
        label: "Annual Decline Rate",
        type: "percent",
        min: 0.005,
        max: 0.05,
        step: 0.005,
        default: 0.02,
        tooltip:
          "Annual real spending decline rate. 2% matches EBRI actual spending data.",
        lever: { delta: 0.5, unit: "relative", targets: ["survival"] },
      },
    ],
    crossYearStateKeys: ["initialWithdrawalAmount", "decumulationYearCount"],
    guide: {
      how: "Based on EBRI research showing retirees' real spending declines ~2% annually. Spending grows with CPI (maintaining nominal value) but the 2% real decline means purchasing power intentionally reduces each year.",
      strengths: [
        "Matches actual retiree behavior — most people spend less as they age",
        "Higher initial withdrawal rate than Fixed Real (~5.0% vs ~3.9%)",
        "Very conservative over time — builds large legacy",
      ],
      weaknesses: [
        "No market feedback — spending follows a predetermined schedule regardless of portfolio performance",
        "Spending stability will always read 0% because the intentional decline eventually crosses the 75% threshold (~14 years)",
        "May under-spend in later years when healthcare costs actually increase",
      ],
      bestFor:
        "Retirees who want higher early spending and expect to naturally slow down.",
      stabilityNote:
        "Always 0% stability — by design. The 2% annual real decline means spending crosses below 75% of the inflation-adjusted baseline around year 14. This is the strategy working as intended, not a failure.",
    },
  },

  constant_percentage: {
    label: "Constant Percentage",
    shortLabel: "Const %",
    description:
      "Fixed percentage of current portfolio balance each year, with a floor to prevent severe cuts",
    morningstarRef: "Method 5",
    incomeSource: "rate",
    usesWithdrawalRate: false,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    paramFields: [
      {
        key: "withdrawalPercent",
        column: "cpWithdrawalPercent",
        label: "Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip: "Percentage of current portfolio balance withdrawn each year.",
        lever: {
          delta: -0.2,
          unit: "relative",
          targets: ["survival", "smoothness"],
        },
      },
      {
        key: "floorPercent",
        column: "cpFloorPercent",
        label: "Floor (% of Initial)",
        type: "percent",
        min: 0.5,
        max: 1.0,
        step: 0.05,
        default: 0.9,
        tooltip:
          "Minimum withdrawal as a percentage of the initial withdrawal amount.",
        lever: { delta: -0.1, unit: "relative", targets: ["survival"] },
      },
      {
        key: "ssInAmount",
        column: "cpSsInAmount",
        label: "Social Security comes out of this amount",
        type: "boolean",
        nullable: true,
        default: false,
        tooltip:
          "Off (the method as published): the amount is what leaves the portfolio each year, and Social Security comes on top of it. On: the amount is your spending, and Social Security pays part of it — less leaves the portfolio once it starts.",
      },
    ],
    crossYearStateKeys: ["initialWithdrawalAmount"],
    guide: {
      how: "Each year, withdraw 5% of whatever your portfolio is worth. A nominal floor at 90% of your initial withdrawal prevents the most severe cuts. Because you only take a percentage, the portfolio can never reach zero.",
      strengths: [
        "Self-correcting — spending automatically adjusts to portfolio performance",
        "Can never fully deplete the portfolio (mathematically impossible without the floor binding)",
        "Simple to understand and implement",
      ],
      weaknesses: [
        "Income is volatile — a 30% portfolio drop means a ~30% spending cut",
        "The nominal floor erodes in real terms over time",
        "Spending stability is inherently low because income tracks portfolio volatility",
      ],
      bestFor:
        "Retirees with guaranteed income (SS, pensions) covering essentials, using portfolio for variable discretionary spending.",
      stabilityNote:
        "Low stability (3–5%) is expected — not a flaw. Spending tracks portfolio balance, so over a 40-year horizon, nearly every scenario has at least one year where spending dips below 75% of the inflation-adjusted baseline.",
    },
  },

  endowment: {
    label: "Endowment",
    shortLabel: "Endow.",
    description:
      "Fixed percentage of N-year rolling average balance — smooths volatility like an endowment fund",
    morningstarRef: "Method 6",
    incomeSource: "rate",
    usesWithdrawalRate: false,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    paramFields: [
      {
        key: "withdrawalPercent",
        column: "enWithdrawalPercent",
        label: "Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip:
          "Percentage of the rolling average balance withdrawn each year.",
        lever: {
          delta: -0.2,
          unit: "relative",
          targets: ["survival", "smoothness"],
        },
      },
      {
        key: "rollingYears",
        column: "enRollingYears",
        label: "Rolling Window (years)",
        type: "number",
        integer: true,
        min: 3,
        max: 20,
        step: 1,
        default: DEFAULT_ENDOWMENT_ROLLING_YEARS,
        tooltip:
          "Number of years for the rolling average balance calculation. A longer window smooths more volatility at the cost of responsiveness.",
        lever: { delta: 0.5, unit: "relative", targets: ["smoothness"] },
      },
      {
        key: "floorPercent",
        column: "enFloorPercent",
        label: "Floor (% of Initial)",
        type: "percent",
        min: 0.5,
        max: 1.0,
        step: 0.05,
        default: 0.9,
        tooltip:
          "Minimum withdrawal as a percentage of the initial withdrawal amount.",
      },
      {
        key: "ssInAmount",
        column: "enSsInAmount",
        label: "Social Security comes out of this amount",
        type: "boolean",
        nullable: true,
        default: false,
        tooltip:
          "Off (the method as published): the amount is what leaves the portfolio each year, and Social Security comes on top of it. On: the amount is your spending, and Social Security pays part of it — less leaves the portfolio once it starts.",
      },
    ],
    crossYearStateKeys: ["initialWithdrawalAmount", "balanceHistory"],
    guide: {
      how: "Withdraw 5% of the 10-year rolling average portfolio balance. This smooths out year-to-year market swings. A nominal floor at 90% of initial withdrawal prevents severe cuts.",
      strengths: [
        "Smoother income than Constant Percentage — volatility is dampened by the rolling average",
        "Based on how university endowments (Yale, Stanford) manage spending",
        "Self-correcting like Constant Percentage",
      ],
      weaknesses: [
        "Slower to recover after market downturns (averaging lags behind recovery)",
        "Slower to benefit from market gains for the same reason",
        "Still has low spending stability because income ultimately tracks portfolio performance",
      ],
      bestFor:
        "Retirees who want portfolio-linked spending but with less year-to-year income volatility.",
      stabilityNote:
        "Slightly higher stability than Constant % due to smoothing, but still low (3–5%). The rolling average dampens short-term swings but can't prevent long-term portfolio-driven spending changes.",
    },
  },

  vanguard_dynamic: {
    label: "Vanguard Dynamic (Floor & Ceiling)",
    shortLabel: "Vanguard",
    description:
      "Base percentage of balance with ceiling and floor on year-over-year spending changes",
    morningstarRef: "Method 8",
    incomeSource: "rate",
    usesWithdrawalRate: false,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    paramFields: [
      {
        key: "basePercent",
        column: "vdBasePercent",
        label: "Base Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip: "Base percentage of current portfolio balance.",
        lever: {
          delta: -0.2,
          unit: "relative",
          targets: ["survival", "smoothness"],
        },
      },
      {
        key: "ceilingPercent",
        column: "vdCeilingPercent",
        label: "Ceiling (max nominal YoY increase)",
        type: "percent",
        min: 0.01,
        max: 0.15,
        step: 0.005,
        default: 0.05,
        tooltip:
          "Maximum year-over-year increase in nominal dollars, before inflation (e.g. 5% = spending can grow at most 5% per year; at 3% inflation that's about 1.9% in real terms).",
      },
      {
        key: "floorPercent",
        column: "vdFloorPercent",
        label: "Floor (max nominal YoY decrease)",
        type: "percent",
        min: 0.01,
        max: 0.1,
        step: 0.005,
        default: 0.025,
        tooltip:
          "Maximum year-over-year decrease in nominal dollars, before inflation (e.g. 2.5% = spending can fall at most 2.5% per year; at 3% inflation that's about 5.4% in real terms).",
        lever: { delta: -0.4, unit: "relative", targets: ["smoothness"] },
      },
      {
        key: "ssInAmount",
        column: "vdSsInAmount",
        label: "Social Security comes out of this amount",
        type: "boolean",
        nullable: true,
        default: false,
        tooltip:
          "Off (the method as published): the amount is what leaves the portfolio each year, and Social Security comes on top of it. On: the amount is your spending, and Social Security pays part of it — less leaves the portfolio once it starts.",
      },
    ],
    crossYearStateKeys: ["priorYearSpending"],
    guide: {
      how: "Withdraw 5% of your current portfolio, but limit year-over-year changes: spending can rise at most 5% or fall at most 2.5% from the prior year, in nominal dollars. This creates a smoother income stream than pure Constant Percentage. The limits are nominal like every percentage-based strategy's floor, so at 3% inflation the 2.5% cut is about 5.4% in real terms and the 5% raise about 1.9%. The published method applies them to inflation-adjusted spending, so results won't match its 4.7% figure exactly.",
      strengths: [
        "Excellent downside protection — spending can only fall 2.5% per year in nominal dollars, not 30%+",
        "Asymmetric guardrails favor stability (tighter floor than ceiling)",
        "Based on Vanguard research (2012), well-tested methodology",
        "High success rate — typically 100%",
      ],
      weaknesses: [
        "Compounding 2.5% annual cuts during prolonged bear markets can still erode spending significantly",
        "Slow to recover spending after downturns (5% ceiling limits the bounce-back)",
        "No absolute floor — spending can drift down indefinitely through compounding small cuts",
      ],
      bestFor:
        "Retirees who want portfolio-linked spending with strong short-term income stability.",
      stabilityNote:
        "Low stability (3–5%) despite smooth year-to-year changes. The metric measures against an inflation-adjusted baseline over the full retirement, and even small compounding cuts accumulate over 40 years.",
    },
  },

  vpw: {
    label: "Variable Percentage (VPW)",
    shortLabel: "VPW",
    description:
      "Bogleheads' Variable Percentage Withdrawal — a percentage of the balance that rises with age and allocation, spending the portfolio down by a set age",
    morningstarRef: null,
    incomeSource: "formula",
    usesWithdrawalRate: false,
    usesPostRetirementRaise: false,
    reactsToVolatility: false,
    fixedParams: {
      // The real returns the published table is built on.
      stockReturn: 0.05,
      bondReturn: 0.019,
      // Used when the projection has no asset allocation.
      stockShare: 0.6,
    },
    paramFields: [
      {
        key: "cap",
        column: "vpwCap",
        label: "Most it reaches",
        type: "percent",
        nullable: true,
        min: 0.05,
        max: 0.2,
        step: 0.005,
        default: 0.1,
        tooltip:
          '"The withdrawal percentage stops growing when it reaches 10%" (Bogleheads). Past this the percentage holds.',
        lever: { delta: -0.2, unit: "relative", targets: ["survival"] },
      },
      {
        key: "endAge",
        column: "vpwEndAge",
        label: "Table runs to age",
        type: "number",
        integer: true,
        nullable: true,
        min: 90,
        max: 110,
        step: 1,
        default: 100,
        tooltip:
          "The age the percentages are built to spend the portfolio by. The published table runs to 100.",
        lever: { delta: 5, unit: "absolute", targets: ["survival"] },
      },
      {
        key: "ssInAmount",
        column: "vpwSsInAmount",
        label: "Social Security comes out of this amount",
        type: "boolean",
        nullable: true,
        default: false,
        tooltip:
          "Off (the method as published): the amount is what leaves the portfolio each year, and Social Security comes on top of it. On: the amount is your spending, and Social Security pays part of it — less leaves the portfolio once it starts.",
      },
    ],
    crossYearStateKeys: [],
    guide: {
      how: "Each year, withdraw a percentage of the portfolio that depends on your age (the younger spouse's, for a couple) and how much is in stocks — the payment that would spend the balance by age 100 at 5% real for stocks and 1.9% for bonds. At 65 with 60% stocks it's 5.0%; it rises every year, and stops growing at 10%. Social Security comes on top.",
      strengths: [
        "Spends the portfolio on purpose — no large unspent balance at the end",
        "Self-correcting: the withdrawal follows the balance, so it can't run out before the end age",
        "Simple yearly rule with a published table to check against",
      ],
      weaknesses: [
        "Income moves with the market, like any percentage-of-balance method",
        "Spending rises late in life as the percentage climbs; living past the end age leaves little",
        "Bogleheads suggests buying an annuity around 80 to cover living past 100 — Ledgr doesn't model that",
      ],
      bestFor:
        "Retirees who want to spend their savings fully, with Social Security or pensions as the floor.",
      stabilityNote:
        "Low stability is expected — spending tracks the balance, and the percentage itself rises with age.",
    },
  },
} as const satisfies Record<string, WithdrawalStrategyConfig>;

// ---------------------------------------------------------------------------
// Derived type — auto-expands when you add a config entry
// ---------------------------------------------------------------------------

export type WithdrawalStrategyType = keyof typeof WITHDRAWAL_STRATEGY_CONFIG;

// ---------------------------------------------------------------------------
// Query helpers — all derived from config
// ---------------------------------------------------------------------------

/** All strategy keys as a Zod-compatible tuple. */
export const WITHDRAWAL_STRATEGY_VALUES = Object.keys(
  WITHDRAWAL_STRATEGY_CONFIG,
) as [WithdrawalStrategyType, ...WithdrawalStrategyType[]];

/** All strategy keys. */
export function getAllStrategyKeys(): WithdrawalStrategyType[] {
  return Object.keys(WITHDRAWAL_STRATEGY_CONFIG) as WithdrawalStrategyType[];
}

/** Get full config for a strategy. */
export function getStrategyMeta(
  key: WithdrawalStrategyType,
): WithdrawalStrategyConfig {
  return WITHDRAWAL_STRATEGY_CONFIG[key];
}

type FieldsOf<K extends WithdrawalStrategyType> =
  (typeof WITHDRAWAL_STRATEGY_CONFIG)[K]["paramFields"][number];
/** A strategy param field, with its literal key, column and flags. */
export type StrategyParamField = FieldsOf<WithdrawalStrategyType>;
/** A retirement_settings column a strategy param is stored in. */
export type StrategyParamColumn = StrategyParamField["column"];
/** A strategy's params with nothing stored: each field's default, and its
 *  fixed params. */
export type StrategyDefaults<K extends WithdrawalStrategyType> = {
  [F in FieldsOf<K> as F["key"]]: F["type"] extends "boolean"
    ? boolean
    : number;
} & ((typeof WITHDRAWAL_STRATEGY_CONFIG)[K] extends { fixedParams: infer P }
  ? P
  : unknown);

/** Default params for a strategy, from its param fields' defaults. */
export function getStrategyDefaults<K extends WithdrawalStrategyType>(
  key: K,
): StrategyDefaults<K> {
  const cfg: WithdrawalStrategyConfig = WITHDRAWAL_STRATEGY_CONFIG[key];
  const fromFields = cfg.paramFields.map((f) => [f.key, f.default] as const);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- built from the same fields StrategyDefaults maps
  return {
    ...cfg.fixedParams,
    ...Object.fromEntries(fromFields),
  } as StrategyDefaults<K>;
}

/** Every strategy's param fields, in config order. */
export function strategyParamFields(): StrategyParamField[] {
  return getAllStrategyKeys().flatMap((k) => [
    ...WITHDRAWAL_STRATEGY_CONFIG[k].paramFields,
  ]);
}

/** Zod-compatible enum tuple. */
export function withdrawalStrategyEnum(): [
  WithdrawalStrategyType,
  ...WithdrawalStrategyType[],
] {
  return WITHDRAWAL_STRATEGY_VALUES;
}
