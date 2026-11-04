/**
 * Pay-period configuration table.
 *
 * Single source of truth for pay frequency → periods/year, default budget
 * periods per month, and UI labels/notes. Replaces all inline maps and
 * hardcoded help text strings throughout the codebase.
 */
import type { PayPeriod } from "./enum-values";

type PayPeriodConfig = {
  periodsPerYear: number;
  defaultBudgetPerMonth: number;
  label: string;
  budgetNote: string;
};

export const PAY_PERIOD_CONFIG: Readonly<Record<PayPeriod, PayPeriodConfig>> = {
  weekly: {
    periodsPerYear: 52,
    defaultBudgetPerMonth: 4,
    label: "Weekly",
    budgetNote: "4 paychecks/month (5th paycheck months excluded)",
  },
  biweekly: {
    periodsPerYear: 26,
    defaultBudgetPerMonth: 2,
    label: "Biweekly",
    budgetNote: "2 paychecks/month (3rd paycheck months excluded)",
  },
  semimonthly: {
    periodsPerYear: 24,
    defaultBudgetPerMonth: 2,
    label: "Semimonthly",
    budgetNote: "2 paychecks/month (exact)",
  },
  monthly: {
    periodsPerYear: 12,
    defaultBudgetPerMonth: 1,
    label: "Monthly",
    budgetNote: "1 paycheck/month (exact)",
  },
};

/** The config for a stored pay-period string; undefined if it isn't one. */
export function payPeriodConfig(
  payPeriod: string,
): PayPeriodConfig | undefined {
  return isPayPeriod(payPeriod) ? PAY_PERIOD_CONFIG[payPeriod] : undefined;
}

// A key check, not payPeriodSchema: client code reads this file.
function isPayPeriod(value: string): value is PayPeriod {
  return Object.hasOwn(PAY_PERIOD_CONFIG, value);
}

/** Paychecks per year for a pay period; throws for a value that isn't one. */
export function getPeriodsPerYear(payPeriod: string): number {
  const config = payPeriodConfig(payPeriod);
  if (config === undefined) {
    throw new Error(
      `Unknown pay period "${payPeriod}". Expected: weekly, biweekly, semimonthly, or monthly.`,
    );
  }
  return config.periodsPerYear;
}
