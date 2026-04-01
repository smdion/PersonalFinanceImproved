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
