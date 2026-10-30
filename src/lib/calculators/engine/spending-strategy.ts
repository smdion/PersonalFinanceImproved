/**
 * Spending strategy — common interface and dispatcher.
 *
 * Every spending strategy implements SpendingStrategyInput → SpendingStrategyResult.
 * The dispatcher maps strategy keys to engine functions. Adding a new strategy =
 * one engine file + one case in the dispatcher.
 *
 * Cross-year state is orchestrator-owned and passed in each year.
 */
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { applyForgoInflation } from "./forgo-inflation";
import { applySpendingDecline } from "./spending-decline";
import { applyConstantPercentage } from "./constant-percentage";
import { applyEndowment } from "./endowment";
import { applyVanguardDynamic } from "./vanguard-dynamic";
import { applyRmdSpending } from "./rmd-spending";
import { applyGuytonKlingerStrategy } from "./guyton-klinger";
import { applyVpw } from "./vpw";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpendingStrategyInput {
  /** Current projected expenses (already inflation-adjusted by orchestrator). */
  projectedExpenses: number;
  /** Total portfolio balance at start of year (pre-withdrawal). */
  portfolioBalance: number;
  /** Effective inflation rate applied this year (post-retirement raise rate). */
  effectiveInflation: number;
  /** CPI inflation rate — used for inflation-adjusted floors to maintain real
   *  purchasing power independently of the post-retirement raise setting. */
  cpiInflation: number;
  /** Whether a budget override is active this year. */
  hasBudgetOverride: boolean;
  /** Year index (0-based from projection start). */
  yearIndex: number;
  /** Current age of the retiree (household average). */
  age: number;
  /** Primary person's age (for RMD factor lookup). Falls back to `age` if not provided. */
  primaryPersonAge?: number;
  /** The youngest person's age (VPW: a couple uses the younger spouse's). */
  youngestAge?: number;
  /** Social Security paid this year (what it covers of spending). */
  ssIncome?: number;
  /** This year's stock share of the portfolio (0–1), from the allocation
   *  glide path; absent when the household has no asset classes. */
  stockShare?: number;
  /** Cross-year state from the orchestrator. */
  crossYearState: SpendingCrossYearState;
}

export interface SpendingCrossYearState {
  /** Initial withdrawal rate (set on first decumulation year). */
  initialWithdrawalRate: number | null;
  /** Initial withdrawal dollar amount (set on first decumulation year). */
  initialWithdrawalAmount: number | null;
  /** Prior year's portfolio return rate. Null for first year. */
  priorYearReturn: number | null;
  /** Prior year's spending amount. Null for first year. */
  priorYearSpending: number | null;
  /** Balance history for endowment rolling average. */
  balanceHistory: number[];
  /** Count of decumulation years elapsed (for spending decline). */
  decumulationYearCount: number;
  /** Social Security paid last year (Guyton-Klinger rescales its anchor
   *  when it changes). Null before the first decumulation year. */
  priorYearSsIncome: number | null;
}

export interface SpendingStrategyResult {
  /** This year's amount — spending, or the portfolio withdrawal (see
   *  `amountKind`). */
  projectedExpenses: number;
  /** What the amount is this year: what the household spends (Social
   *  Security pays part of it — the default), or what leaves the portfolio
   *  (the published portfolio-sized methods). A strategy can switch from
   *  year to year (RMD Spending before the RMD age follows the budget).
   *  The household's `ssInAmount` switch can still treat a
   *  portfolio_withdrawal amount as spending. */
  amountKind?: "spending" | "portfolio_withdrawal";
  /** Action label (e.g. 'increase', 'decrease', 'floor_applied'). */
  action: string | null;
  /** Updates to merge into cross-year state. */
  updatedState: Partial<SpendingCrossYearState>;
}

/** Create a fresh cross-year state for the start of a projection. */
export function initialCrossYearState(): SpendingCrossYearState {
  return {
    initialWithdrawalRate: null,
    initialWithdrawalAmount: null,
    priorYearReturn: null,
    priorYearSpending: null,
    balanceHistory: [],
    decumulationYearCount: 0,
    priorYearSsIncome: null,
  };
}

// ---------------------------------------------------------------------------
// Per-strategy typed params — one interface per strategy that has params
// ---------------------------------------------------------------------------

/** Forgo Inflation After Loss: no configurable params. */
export type ForgoInflationParams = Record<string, never>;

/** RMD-Based Spending params. */
export interface RmdSpendingParams {
  rmdMultiplier: number;
}

/** Guyton-Klinger guardrail params. */
export interface GuytonKlingerStrategyParams {
  upperGuardrail: number;
  lowerGuardrail: number;
  increasePercent: number;
  decreasePercent: number;
  skipInflationAfterLoss: boolean;
}

/** Spending Decline params. */
export interface SpendingDeclineParams {
  annualDeclineRate: number;
}

/** Constant Percentage params. */
export interface ConstantPercentageParams {
  withdrawalPercent: number;
  floorPercent: number;
}

/** Endowment params. */
export interface EndowmentParams {
  withdrawalPercent: number;
  rollingYears: number;
  floorPercent: number;
}

/** Variable Percentage Withdrawal params. */
export interface VpwParams {
  /** The most the percentage reaches. */
  cap: number;
  /** The age the table runs to. */
  endAge: number;
  /** Real returns VPW assumes for stocks and bonds. */
  stockReturn: number;
  bondReturn: number;
  /** Stock share used when the projection has no allocation. */
  stockShare: number;
}

/** Vanguard Dynamic (Floor & Ceiling) params. */
export interface VanguardDynamicParams {
  basePercent: number;
  ceilingPercent: number;
  floorPercent: number;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type StrategyFn = (
  params: Record<string, number | boolean>,
  input: SpendingStrategyInput,
) => SpendingStrategyResult;

const STRATEGY_DISPATCH: Record<WithdrawalStrategyType, StrategyFn> = {
  fixed: (_params, input) => ({
    projectedExpenses: input.projectedExpenses,
    action: null,
    updatedState: {},
  }),
  forgo_inflation_after_loss: applyForgoInflation,
  rmd_spending: applyRmdSpending,
  guyton_klinger: applyGuytonKlingerStrategy,
  spending_decline: applySpendingDecline,
  constant_percentage: applyConstantPercentage,
  endowment: applyEndowment,
  vanguard_dynamic: applyVanguardDynamic,
  vpw: applyVpw,
};

/**
 * Apply the selected spending strategy.
 *
 * Pure function — does not mutate inputs. Returns adjusted spending
 * and any cross-year state updates.
 */
export function applySpendingStrategy(
  strategy: WithdrawalStrategyType,
  params: Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const fn = STRATEGY_DISPATCH[strategy];
  return fn(params, input);
}
