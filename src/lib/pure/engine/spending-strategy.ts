/**
 * Spending strategy interface (SpendingStrategyInput → SpendingStrategyResult) and dispatcher.
 * A new strategy is one engine file plus one dispatcher case; the orchestrator owns cross-year state.
 */
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { applyForgoInflation } from "./spending-strategies/forgo-inflation";
import { applySpendingDecline } from "./spending-strategies/spending-decline";
import { applyConstantPercentage } from "./spending-strategies/constant-percentage";
import { applyEndowment } from "./spending-strategies/endowment";
import { applyVanguardDynamic } from "./spending-strategies/vanguard-dynamic";
import { applyRmdSpending } from "./spending-strategies/rmd-spending";
import { applyGuytonKlingerStrategy } from "./spending-strategies/guyton-klinger";
import { applyVpw } from "./spending-strategies/vpw";
import type {
  SpendingCrossYearState,
  SpendingStrategyInput,
  SpendingStrategyResult,
} from "./types/spending-strategy";

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
