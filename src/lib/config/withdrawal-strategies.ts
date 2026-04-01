// Central withdrawal-strategy configuration — the ONLY place strategy-specific
// knowledge lives. Everything else imports from here.
//
// Philosophy: Config declares, code executes.
// Nothing in the codebase knows what "Guyton-Klinger" is — it only knows how to
// process a strategy with properties like `paramFields` and `defaultParams`.
//
// References: Morningstar "State of Retirement Income: 2025"

// ---------------------------------------------------------------------------
// Param field descriptor — drives UI rendering
// ---------------------------------------------------------------------------

export type ParamFieldType = "percent" | "number" | "boolean";

export type ParamField = {
  key: string;
  label: string;
  type: ParamFieldType;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean;
  tooltip?: string;
  /** Fields sharing the same group render side-by-side as a visual pair. */
  group?: string;
};

// ---------------------------------------------------------------------------
// Strategy config shape
// ---------------------------------------------------------------------------

/** How the strategy determines annual spending — drives UI visibility of budget/rate controls. */
export type IncomeSource = "budget" | "rate" | "formula";

/** Strategy guide content — rendered by the Strategy Guide panel. */
export type StrategyGuide = {
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

export type WithdrawalStrategyConfig = {
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
  /** Default parameter values keyed by param name. */
  defaultParams: Readonly<Record<string, number | boolean>>;
  /** UI-renderable parameter field descriptors. */
  paramFields: readonly ParamField[];
  /** Whether the strategy uses the user's Initial Withdrawal Rate setting. */
  usesWithdrawalRate: boolean;
  /** Whether the strategy uses the Post-Retirement Raise to grow expenses. */
  usesPostRetirementRaise: boolean;
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
    defaultParams: {},
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
        "Retirees who prioritize income certainty and have a conservative withdrawal rate.",
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
    defaultParams: {},
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
    defaultParams: {
      rmdMultiplier: 1.0,
    },
    paramFields: [
      {
        key: "rmdMultiplier",
        label: "RMD Multiplier",
        type: "number",
        min: 0.5,
        max: 3.0,
        step: 0.1,
        default: 1.0,
        tooltip:
          "Multiplier applied to the IRS RMD amount. 1.0 = standard RMD.",
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
    defaultParams: {
      upperGuardrail: 0.8,
      lowerGuardrail: 1.2,
      increasePercent: 0.1,
      decreasePercent: 0.1,
      skipInflationAfterLoss: true,
    },
    paramFields: [
      {
        key: "upperGuardrail",
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
        label: "Increase %",
        type: "percent",
        min: 0.01,
        max: 0.3,
        step: 0.01,
        default: 0.1,
        tooltip:
          "Spending increase when upper guardrail triggers (portfolio outperforming).",
        group: "prosperity",
      },
      {
        key: "lowerGuardrail",
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
        label: "Decrease %",
        type: "percent",
        min: 0.01,
        max: 0.3,
        step: 0.01,
        default: 0.1,
        tooltip:
          "Spending decrease when lower guardrail triggers (portfolio underperforming).",
        group: "preservation",
      },
      {
        key: "skipInflationAfterLoss",
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
    ],
    guide: {
      how: "Start with your budget, adjusted for inflation each year. If your current withdrawal rate drops below 80% of the initial rate (portfolio doing well), increase spending 10%. If it exceeds 120% (portfolio struggling), cut spending 10%. Also skips inflation after loss years.",
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
    defaultParams: {
      annualDeclineRate: 0.02,
    },
    paramFields: [
      {
        key: "annualDeclineRate",
        label: "Annual Decline Rate",
        type: "percent",
        min: 0.005,
        max: 0.05,
        step: 0.005,
        default: 0.02,
        tooltip:
          "Annual real spending decline rate. 2% matches EBRI actual spending data.",
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
    defaultParams: {
      withdrawalPercent: 0.05,
      floorPercent: 0.9,
    },
    paramFields: [
      {
        key: "withdrawalPercent",
        label: "Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip: "Percentage of current portfolio balance withdrawn each year.",
      },
      {
        key: "floorPercent",
        label: "Floor (% of Initial)",
        type: "percent",
        min: 0.5,
        max: 1.0,
        step: 0.05,
        default: 0.9,
        tooltip:
          "Minimum withdrawal as a percentage of the initial withdrawal amount.",
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
    defaultParams: {
      withdrawalPercent: 0.05,
      rollingYears: 5,
      floorPercent: 0.9,
    },
    paramFields: [
      {
        key: "withdrawalPercent",
        label: "Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip:
          "Percentage of the rolling average balance withdrawn each year.",
      },
      {
        key: "rollingYears",
        label: "Rolling Window (years)",
        type: "number",
        min: 3,
        max: 20,
        step: 1,
        default: 5,
        tooltip:
          "Number of years for the rolling average balance calculation. Standard endowment practice is 3–5 years.",
      },
      {
        key: "floorPercent",
        label: "Floor (% of Initial)",
        type: "percent",
        min: 0.5,
        max: 1.0,
        step: 0.05,
        default: 0.9,
        tooltip:
          "Minimum withdrawal as a percentage of the initial withdrawal amount.",
      },
    ],
    crossYearStateKeys: ["initialWithdrawalAmount", "balanceHistory"],
    guide: {
      how: "Withdraw 5% of the 5-year rolling average portfolio balance. This smooths out year-to-year market swings. A nominal floor at 90% of initial withdrawal prevents severe cuts.",
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
    defaultParams: {
      basePercent: 0.05,
      ceilingPercent: 0.05,
      floorPercent: 0.025,
    },
    paramFields: [
      {
        key: "basePercent",
        label: "Base Withdrawal %",
        type: "percent",
        min: 0.02,
        max: 0.1,
        step: 0.005,
        default: 0.05,
        tooltip: "Base percentage of current portfolio balance.",
      },
      {
        key: "ceilingPercent",
        label: "Ceiling (max YoY increase)",
        type: "percent",
        min: 0.01,
        max: 0.15,
        step: 0.005,
        default: 0.05,
        tooltip:
          "Maximum year-over-year spending increase (e.g. 5% = spending can grow at most 5% per year).",
      },
      {
        key: "floorPercent",
        label: "Floor (max YoY decrease)",
        type: "percent",
        min: 0.01,
        max: 0.1,
        step: 0.005,
        default: 0.025,
        tooltip:
          "Maximum year-over-year spending decrease (e.g. 2.5% = spending can fall at most 2.5% per year).",
      },
    ],
    crossYearStateKeys: ["priorYearSpending"],
    guide: {
      how: "Withdraw 5% of your current portfolio, but limit year-over-year changes: spending can rise at most 5% or fall at most 2.5% from the prior year. This creates a smoother income stream than pure Constant Percentage.",
      strengths: [
        "Excellent downside protection — spending can only fall 2.5% per year, not 30%+",
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
} as const;

// Validate: every config entry must conform to WithdrawalStrategyConfig.
function _validateConfig<T extends Record<string, WithdrawalStrategyConfig>>(
  c: T,
): T {
  return c;
}
_validateConfig(WITHDRAWAL_STRATEGY_CONFIG);

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

/** Get default params for a strategy. */
export function getStrategyDefaults(
  key: WithdrawalStrategyType,
): Record<string, number | boolean> {
  return { ...WITHDRAWAL_STRATEGY_CONFIG[key].defaultParams };
}

/** Display label map — same pattern as display-labels.ts. */
export const WITHDRAWAL_STRATEGY_LABELS: Record<
  WithdrawalStrategyType,
  string
> = Object.fromEntries(
  Object.entries(WITHDRAWAL_STRATEGY_CONFIG).map(([k, v]) => [k, v.label]),
) as Record<WithdrawalStrategyType, string>;

/** Zod-compatible enum tuple. */
export function withdrawalStrategyEnum(): [
  WithdrawalStrategyType,
  ...WithdrawalStrategyType[],
] {
  return WITHDRAWAL_STRATEGY_VALUES;
}
