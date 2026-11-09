/**
 * Low-level transform utilities shared across all helper modules.
 */
import { PAY_PERIOD_CONFIG, payPeriodConfig } from "@/lib/config/pay-periods";

/**
 * Pay periods per calendar month for budgets, not annualized: extra paycheck months are
 * handled separately. Annual projections use getPeriodsPerYear()/12 instead.
 * A per-job `jobs.budget_periods_per_month` override wins when set.
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
