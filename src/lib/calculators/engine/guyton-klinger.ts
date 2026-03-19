/**
 * Guyton-Klinger — dynamic spending guardrails.
 *
 * Adjusts spending dynamically based on portfolio performance during
 * decumulation. Implements upper/lower guardrails and the prosperity rule
 * (skip inflation after a loss year).
 *
 * Cross-year state (initialWithdrawalRate, priorYearReturn, baseSpending)
 * is owned by the orchestrator and passed in each year.
 */
import { roundToCents } from "../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  GuytonKlingerStrategyParams,
} from "./spending-strategy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuytonKlingerParams {
  /** If currentRate < initialRate × upperGuardrail, increase spending. */
  upperGuardrail: number;
  /** If currentRate > initialRate × lowerGuardrail, decrease spending. */
  lowerGuardrail: number;
  /** Spending increase when upper guardrail triggers. E.g. 0.10 = 10%. */
  increasePercent: number;
  /** Spending decrease when lower guardrail triggers. E.g. 0.10 = 10%. */
  decreasePercent: number;
  /** Skip inflation adjustment in years following a portfolio loss. */
  skipInflationAfterLoss: boolean;
}

export interface GuytonKlingerInput {
  params: GuytonKlingerParams;
  /** Current projected expenses (already inflation-adjusted by orchestrator). */
  projectedExpenses: number;
  /** Total portfolio balance at start of year (pre-withdrawal). */
  portfolioBalance: number;
  /** Effective inflation rate applied this year. */
  effectiveInflation: number;
  /** Whether a budget override is active this year. */
  hasBudgetOverride: boolean;
  /** Whether this is the first decumulation year (y > 0 from orchestrator). */
  isFirstDecumulationYear: boolean;
  /** Year index > 0 (needed to check if inflation was applied). */
  yearIndex: number;
  // --- Cross-year state (orchestrator-owned) ---
  /** Initial withdrawal rate, set on first decumulation year. Null if not yet set. */
  initialWithdrawalRate: number | null;
  /** Prior year's return rate. Null for first year. */
  priorYearReturn: number | null;
}

export interface GuytonKlingerResult {
  /** Adjusted spending for this year. */
  projectedExpenses: number;
  /** Which guardrail triggered, if any. */
  guardrailTriggered: "increase" | "decrease" | "skip_inflation" | null;
  // --- Updated cross-year state ---
  /** Initial withdrawal rate (set on first call, unchanged after). */
  initialWithdrawalRate: number | null;
  /** Updated base spending. */
  baseSpending: number | null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Apply Guyton-Klinger dynamic spending guardrails.
 *
 * Returns adjusted expenses and updated cross-year state.
 * Does NOT mutate any input.
 */
export function applyGuytonKlinger(
  input: GuytonKlingerInput,
): GuytonKlingerResult {
  const {
    params: gk,
    portfolioBalance,
    effectiveInflation,
    hasBudgetOverride,
    yearIndex,
  } = input;
  let { projectedExpenses, initialWithdrawalRate } = input;
  let guardrailTriggered: GuytonKlingerResult["guardrailTriggered"] = null;

  if (portfolioBalance <= 0) {
    return {
      projectedExpenses,
      guardrailTriggered: null,
      initialWithdrawalRate,
      baseSpending: projectedExpenses,
    };
  }

  if (initialWithdrawalRate === null) {
    // First decumulation year: capture initial rate
    initialWithdrawalRate = projectedExpenses / portfolioBalance;
    return {
      projectedExpenses,
      guardrailTriggered: null,
      initialWithdrawalRate,
      baseSpending: projectedExpenses,
    };
  }

  // Prosperity rule: skip inflation adjustment after a loss year
  if (
    gk.skipInflationAfterLoss &&
    input.priorYearReturn != null &&
    input.priorYearReturn < 0
  ) {
    // Undo the inflation adjustment that was applied by the orchestrator
    if (!hasBudgetOverride && yearIndex > 0) {
      projectedExpenses = projectedExpenses / (1 + effectiveInflation);
      guardrailTriggered = "skip_inflation";
    }
  }

  // Check guardrails
  const currentRate = projectedExpenses / portfolioBalance;
  if (currentRate < initialWithdrawalRate * gk.upperGuardrail) {
    // Portfolio has grown — increase spending
    projectedExpenses = roundToCents(
      projectedExpenses * (1 + gk.increasePercent),
    );
    guardrailTriggered = "increase";
  } else if (currentRate > initialWithdrawalRate * gk.lowerGuardrail) {
    // Portfolio has shrunk — decrease spending
    projectedExpenses = roundToCents(
      projectedExpenses * (1 - gk.decreasePercent),
    );
    guardrailTriggered = "decrease";
  }

  return {
    projectedExpenses,
    guardrailTriggered,
    initialWithdrawalRate,
    baseSpending: projectedExpenses,
  };
}

// ---------------------------------------------------------------------------
// Common interface wrapper — conforms GK to SpendingStrategyInput/Result
// ---------------------------------------------------------------------------

/**
 * Wraps applyGuytonKlinger in the common SpendingStrategy interface.
 * Used by the generic dispatcher in spending-strategy.ts.
 */
export function applyGuytonKlingerStrategy(
  params: GuytonKlingerStrategyParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const p = params as GuytonKlingerStrategyParams;
  const gkParams: GuytonKlingerParams = {
    upperGuardrail: p.upperGuardrail ?? 0.8,
    lowerGuardrail: p.lowerGuardrail ?? 1.2,
    increasePercent: p.increasePercent ?? 0.1,
    decreasePercent: p.decreasePercent ?? 0.1,
    skipInflationAfterLoss: p.skipInflationAfterLoss ?? true,
  };

  const gkResult = applyGuytonKlinger({
    params: gkParams,
    projectedExpenses: input.projectedExpenses,
    portfolioBalance: input.portfolioBalance,
    effectiveInflation: input.effectiveInflation,
    hasBudgetOverride: input.hasBudgetOverride,
    isFirstDecumulationYear:
      input.crossYearState.initialWithdrawalRate === null,
    yearIndex: input.yearIndex,
    initialWithdrawalRate: input.crossYearState.initialWithdrawalRate,
    priorYearReturn: input.crossYearState.priorYearReturn,
  });

  return {
    projectedExpenses: gkResult.projectedExpenses,
    action: gkResult.guardrailTriggered,
    updatedState: {
      initialWithdrawalRate: gkResult.initialWithdrawalRate,
      priorYearSpending: gkResult.baseSpending,
    },
  };
}
