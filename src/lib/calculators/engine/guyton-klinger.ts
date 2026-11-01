/**
 * Guyton-Klinger — dynamic spending guardrails.
 *
 * Adjusts spending dynamically based on portfolio performance during
 * decumulation. Implements upper/lower guardrails and the prosperity rule
 * (skip inflation after a loss year).
 *
 * The guardrails judge the WITHDRAWAL rate — what the portfolio pays
 * (spending less Social Security) over its balance — at the start and each
 * year after, as Guyton and Klinger define it. Judged on total spending,
 * the rate was overstated by everything Social Security covers once it
 * starts. Consistently, a raise or cut moves spending by its percentage of
 * that portfolio draw, not of all spending. And a change in Social Security
 * (it starting, a second person's starting) isn't market news: the anchor
 * rate is rescaled by the same step, so the guardrails react only to how
 * the portfolio has done. Benefits are compared in today's dollars, so its
 * cost-of-living raise is never read as such a change.
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

/** The anchor rescaled for a change in Social Security — a benefit starting
 *  or stopping, compared in today's dollars so a cost-of-living raise isn't
 *  one: the portfolio's share of the same spending before and after, both
 *  benefits at this year's prices. Unchanged when either share is zero (no
 *  rate to compare). */
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
 * Apply Guyton-Klinger dynamic spending guardrails.
 *
 * Returns adjusted expenses and updated cross-year state.
 * Does NOT mutate any input.
 *
 * Exported for direct unit testing only (see guyton-klinger.test.ts's
 * lower-level state/guardrail coverage) — production code must go through
 * `applyGuytonKlingerStrategy`, the only function that conforms to the
 * spending-strategy dispatcher contract. Every other strategy module
 * exposes exactly one public function; importing this one outside a test
 * file creates a second, non-conforming entry point.
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
    // First decumulation year the portfolio pays anything: capture the
    // initial rate. While Social Security covers all of spending there's
    // no rate to anchor to (a 0 anchor would read every later draw as over
    // the lower guardrail) — wait.
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

  // A year the portfolio pays nothing (Social Security covers all of
  // spending) has no rate to judge — and no prosperity rule, as in the
  // years before the first anchor. The anchor carries through unchanged,
  // and so does the Social Security it reflects (`ssIncomeJudged`): the
  // first year the portfolio pays again rescales from the pre-cover level,
  // so what the market did meanwhile still counts. Dropping the anchor and
  // re-anchoring on that first small draw would instead read ordinary
  // spending growth as a doubled withdrawal rate — a cut a year.
  const covered = (spending: number) => ({
    projectedExpenses: spending,
    guardrailTriggered,
    initialWithdrawalRate,
    baseSpending: spending,
    ssIncomeJudged: input.priorSsIncome,
  });
  if (portfolioShare(projectedExpenses) <= 0) return covered(projectedExpenses);

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
  // The prosperity rule took spending under Social Security: covered too.
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
    ssIncome: input.ssIncome ?? 0,
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
