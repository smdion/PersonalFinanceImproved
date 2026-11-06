/**
 * Forgo Inflation After Loss — Morningstar Method 1.
 *
 * If the portfolio had a negative return last year, skip the inflation
 * adjustment for this year. Cumulative real cuts over multiple loss years.
 * SWR: 4.4% (40/60 portfolio, 90% success, 30 years).
 */
import type {
  SpendingStrategyInput,
  SpendingStrategyResult,
  ForgoInflationParams,
} from "./spending-strategy";

export function applyForgoInflation(
  _params: ForgoInflationParams | Record<string, number | boolean>,
  input: SpendingStrategyInput,
): SpendingStrategyResult {
  const {
    projectedExpenses,
    effectiveInflation,
    hasBudgetOverride,
    yearIndex,
    crossYearState,
  } = input;

  // First decumulation year: capture initial amount, no adjustment
  if (crossYearState.initialWithdrawalAmount === null) {
    return {
      projectedExpenses,
      action: null,
      updatedState: { initialWithdrawalAmount: projectedExpenses },
    };
  }

  // If prior year had a loss, undo the inflation adjustment the orchestrator already applied
  if (
    crossYearState.priorYearReturn != null &&
    crossYearState.priorYearReturn < 0 &&
    !hasBudgetOverride &&
    yearIndex > 0
  ) {
    const adjusted = projectedExpenses / (1 + effectiveInflation);
    return {
      projectedExpenses: adjusted,
      action: "skip_inflation",
      updatedState: {},
    };
  }

  return {
    projectedExpenses,
    action: null,
    updatedState: {},
  };
}
