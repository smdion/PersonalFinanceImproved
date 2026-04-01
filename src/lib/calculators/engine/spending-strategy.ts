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
}

export interface SpendingStrategyResult {
  /** Adjusted spending for this year. */
  projectedExpenses: number;
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
  };
}

// ---------------------------------------------------------------------------
// Per-strategy typed params — one interface per strategy that has params
// ---------------------------------------------------------------------------

/** Fixed Real: no configurable params. */
export type FixedParams = Record<string, never>;

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

/** Vanguard Dynamic (Floor & Ceiling) params. */
export interface VanguardDynamicParams {
  basePercent: number;
  ceilingPercent: number;
  floorPercent: number;
}

/** Union of all strategy param types — maps strategy key to its typed params. */
export interface StrategyParamsMap {
  fixed: FixedParams;
  forgo_inflation_after_loss: ForgoInflationParams;
  rmd_spending: RmdSpendingParams;
  guyton_klinger: GuytonKlingerStrategyParams;
  spending_decline: SpendingDeclineParams;
  constant_percentage: ConstantPercentageParams;
  endowment: EndowmentParams;
  vanguard_dynamic: VanguardDynamicParams;
}

/** Params for any strategy — used at API boundaries where strategy type is dynamic. */
export type AnyStrategyParams = StrategyParamsMap[WithdrawalStrategyType];

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
