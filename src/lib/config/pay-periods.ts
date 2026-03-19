/**
 * Pay-period configuration table.
 *
 * Single source of truth for pay frequency → periods/year, default budget
 * periods per month, and UI labels/notes. Replaces all inline maps and
 * hardcoded help text strings throughout the codebase.
 */
export const PAY_PERIOD_CONFIG: Record<
  string,
  {
    periodsPerYear: number;
    defaultBudgetPerMonth: number;
    label: string;
    budgetNote: string;
  }
> = {
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
