/**
 * Guyton-Klinger guardrails on the withdrawal rate (spending less Social Security, over balance).
 * Raises and cuts move the portfolio draw; an SS change (in today's dollars) rescales the anchor
 * instead. Cross-year state is owned by the orchestrator and passed in each year.
 */
import { roundToCents } from "../../../utils/math";
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  GuytonKlingerStrategyParams,
} from "../types/spending-strategy";

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
  /** Social Security paid this year — the part of spending the portfolio
   *  doesn't pay. */
  ssIncome: number;
  /** The same benefits in today's dollars, and this year's growth since
   *  the input's year. Omitted: `ssIncome` and 1 (no growth). */
  ssIncomeToday?: number;
  ssGrowthFactor?: number;
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
  /** The Social Security the anchor reflects, in today's dollars; null in
   *  the first year. */
  priorSsIncome: number | null;
}

interface GuytonKlingerResult {
  /** Adjusted spending for this year. */
  projectedExpenses: number;
  /** Which guardrail triggered, if any. */
  guardrailTriggered: "increase" | "decrease" | "skip_inflation" | null;
  // --- Updated cross-year state ---
  /** Initial withdrawal rate (set on first call, unchanged after). */
  initialWithdrawalRate: number | null;
  /** Updated base spending. */
  baseSpending: number | null;
  /** The Social Security the anchor now reflects — next year's
   *  `priorSsIncome`. Held at last year's through a year the portfolio
   *  pays nothing, so the first year it pays again rescales from there. */
  ssIncomeJudged: number | null;
}

/** The anchor rescaled for a Social Security change: the portfolio's share of the same spending
 *  before and after, both benefits at this year's prices. Unchanged when either share is zero. */
function rescaleForSocialSecurity(
  anchor: number,
  spending: number,
  priorSsToday: number | null,
  ssToday: number,
  ss: number,
  growthFactor: number,
): number {
  if (priorSsToday === null || Math.abs(ssToday - priorSsToday) <= 0.01)
    return anchor;
  const before = Math.max(0, spending - priorSsToday * growthFactor);
  const after = Math.max(0, spending - ss);
  return before > 0 && after > 0 ? anchor * (after / before) : anchor;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Applies the guardrails without mutating input. Exported for unit tests only: production goes
 * through `applyGuytonKlingerStrategy`, the dispatcher-conforming entry point.
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

  // Depleted (under $1, the engine's own line — rounding can leave cents)
  // has no rate to judge.
  if (portfolioBalance < 1) {
    return {
      projectedExpenses,
      guardrailTriggered: null,
      initialWithdrawalRate,
      baseSpending: projectedExpenses,
      ssIncomeJudged: input.ssIncomeToday ?? input.ssIncome,
    };
  }

  const ssToday = input.ssIncomeToday ?? input.ssIncome;
  // What the portfolio pays of a spending figure.
  const portfolioShare = (spending: number) =>
    Math.max(0, spending - input.ssIncome);

  if (initialWithdrawalRate === null) {
    // First year the portfolio pays anything: capture the initial rate.
    // While Social Security covers all spending there's no rate to anchor
    // to (a 0 anchor would trip the lower guardrail), so wait.
    const share = portfolioShare(projectedExpenses);
    if (share <= 0)
      return {
        projectedExpenses,
        guardrailTriggered: null,
        initialWithdrawalRate: null,
        baseSpending: projectedExpenses,
        ssIncomeJudged: input.ssIncomeToday ?? input.ssIncome,
      };
    initialWithdrawalRate = share / portfolioBalance;
    return {
      projectedExpenses,
      guardrailTriggered: null,
      initialWithdrawalRate,
      baseSpending: projectedExpenses,
      ssIncomeJudged: input.ssIncomeToday ?? input.ssIncome,
    };
  }

  // A year SS covers all spending has no rate and no withdrawal rule; the anchor and its
  // `ssIncomeJudged` carry through, so the next paying year rescales from the pre-cover level
  // instead of reading spending growth as a jump in the rate.
  const covered = (spending: number) => ({
    projectedExpenses: spending,
    guardrailTriggered,
    initialWithdrawalRate,
    baseSpending: spending,
    ssIncomeJudged: input.priorSsIncome,
  });
  if (portfolioShare(projectedExpenses) <= 0) return covered(projectedExpenses);

  // Withdrawal rule: skip inflation adjustment after a loss year
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

  initialWithdrawalRate = rescaleForSocialSecurity(
    initialWithdrawalRate,
    projectedExpenses,
    input.priorSsIncome,
    ssToday,
    input.ssIncome,
    input.ssGrowthFactor ?? 1,
  );

  // Check guardrails — moves are a share of the portfolio draw.
  const draw = portfolioShare(projectedExpenses);
  // The withdrawal rule took spending under Social Security: covered too.
  if (draw <= 0) return covered(projectedExpenses);
  const currentRate = draw / portfolioBalance;
  if (currentRate < initialWithdrawalRate * gk.upperGuardrail) {
    // Portfolio has grown — increase spending
    projectedExpenses = roundToCents(
      projectedExpenses + draw * gk.increasePercent,
    );
    guardrailTriggered = "increase";
  } else if (currentRate > initialWithdrawalRate * gk.lowerGuardrail) {
    // Portfolio has shrunk — decrease spending
    projectedExpenses = roundToCents(
      projectedExpenses - draw * gk.decreasePercent,
    );
    guardrailTriggered = "decrease";
  }

  return {
    projectedExpenses,
    guardrailTriggered,
    initialWithdrawalRate,
    baseSpending: projectedExpenses,
    ssIncomeJudged: input.ssIncomeToday ?? input.ssIncome,
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
    ssIncome: input.ssIncome,
    ssIncomeToday: input.ssIncomeToday,
    ssGrowthFactor: input.ssGrowthFactor,
    effectiveInflation: input.effectiveInflation,
    hasBudgetOverride: input.hasBudgetOverride,
    isFirstDecumulationYear:
      input.crossYearState.initialWithdrawalRate === null,
    yearIndex: input.yearIndex,
    initialWithdrawalRate: input.crossYearState.initialWithdrawalRate,
    priorYearReturn: input.crossYearState.priorYearReturn,
    priorSsIncome: input.crossYearState.priorYearSsIncome,
  });

  return {
    projectedExpenses: gkResult.projectedExpenses,
    action: gkResult.guardrailTriggered,
    updatedState: {
      initialWithdrawalRate: gkResult.initialWithdrawalRate,
      priorYearSpending: gkResult.baseSpending,
      priorYearSsIncome: gkResult.ssIncomeJudged,
    },
  };
}
