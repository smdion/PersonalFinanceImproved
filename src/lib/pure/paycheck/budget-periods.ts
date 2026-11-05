/**
 * Low-level transform utilities shared across all helper modules.
 */
import { PAY_PERIOD_CONFIG, payPeriodConfig } from "@/lib/config/pay-periods";

/**
 * Standard number of pay periods per calendar month (not annualized).
 * For budget/savings contexts where extra paycheck months (biweekly/weekly)
 * are handled separately and should not be amortized into monthly income.
 *
 * Use this for monthly budget calculations. Use getPeriodsPerYear()/12 for
 * annual projections (retirement engine, dashboard annual income, etc.).
 *
 * Accepts an optional per-job override from `jobs.budget_periods_per_month`.
 * When set, the override takes precedence over the default for that frequency.
 */
export function getRegularPeriodsPerMonth(
  periodsPerYear: number,
  budgetPeriodsOverride?: number | null,
): number {
  if (budgetPeriodsOverride != null && budgetPeriodsOverride > 0) {
    return budgetPeriodsOverride;
  }
  const config = Object.values(PAY_PERIOD_CONFIG).find(
    (c) => c.periodsPerYear === periodsPerYear,
  );
  return config?.defaultBudgetPerMonth ?? periodsPerYear / 12;
}

/**
 * Build a dynamic budget frequency note for UI help text.
 * Returns a description of how many paychecks are included in the monthly budget.
 */
export function getBudgetFrequencyNote(
  payPeriod: string,
  budgetPeriodsOverride?: number | null,
): string {
  const config = payPeriodConfig(payPeriod);
  if (!config) return "";
  if (
    budgetPeriodsOverride != null &&
    budgetPeriodsOverride > 0 &&
    budgetPeriodsOverride !== config.defaultBudgetPerMonth
  ) {
    return `${budgetPeriodsOverride} paychecks/month (custom — default is ${config.defaultBudgetPerMonth})`;
  }
  return config.budgetNote;
}
