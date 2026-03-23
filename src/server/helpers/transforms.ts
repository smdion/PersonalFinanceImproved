/**
 * Low-level transform utilities shared across all helper modules.
 */
import type { db as _db } from "@/lib/db";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";

/** Shared database type alias. */
export type Db = typeof _db;

/** Parse Drizzle decimal string to number. */
export function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return parseFloat(v);
}

/**
 * Find the primary person from a people array.
 * Falls back to first person if no isPrimaryUser flag is set.
 */
export function getPrimaryPerson<T extends { isPrimaryUser: boolean }>(
  people: T[],
): T | null {
  return people.find((p) => p.isPrimaryUser) ?? people[0] ?? null;
}

export function getPeriodsPerYear(payPeriod: string): number {
  const map: Record<string, number> = {
    weekly: 52,
    biweekly: 26,
    semimonthly: 24,
    monthly: 12,
  };
  const periods = map[payPeriod];
  if (periods === undefined) {
    throw new Error(
      `Unknown pay period "${payPeriod}". Expected: weekly, biweekly, semimonthly, or monthly.`,
    );
  }
  return periods;
}

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
  const map: Record<number, number> = { 52: 4, 26: 2, 24: 2, 12: 1 };
  return map[periodsPerYear] ?? periodsPerYear / 12;
}

/**
 * Build a dynamic budget frequency note for UI help text.
 * Returns a description of how many paychecks are included in the monthly budget.
 */
export function getBudgetFrequencyNote(
  payPeriod: string,
  budgetPeriodsOverride?: number | null,
): string {
  const config = PAY_PERIOD_CONFIG[payPeriod];
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

export type TaxTypeBreakdown = Record<string, number>;

/**
 * Break down snapshot accounts by tax type.
 * Accumulates by whatever taxType key the DB returns — no hardcoded keys.
 */
export function breakdownByTaxType(
  accounts: { taxType: string; amount: number }[],
): TaxTypeBreakdown {
  const result: TaxTypeBreakdown = {};
  for (const a of accounts) {
    result[a.taxType] = (result[a.taxType] ?? 0) + a.amount;
  }
  return result;
}
