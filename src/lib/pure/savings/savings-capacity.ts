/**
 * Pure calculator for savings capacity (budget leftover available for savings goals).
 * Enables per-column cross-mode comparison.
 */

/** Minimal person shape needed for capacity calculation. */
export interface CapacityPerson {
  paycheck: { netPay: number; periodsPerYear: number } | null;
  job: unknown | null;
  budgetPerMonth?: number;
}

/** Minimal shape of a budget.computeActiveSummary-style response needed to
 *  derive a single "monthly spend" figure — weighted-blended when the
 *  profile uses month-weighted modes, otherwise the flat column total. */
interface BudgetMonthlyTotalSource {
  result: { totalMonthly: number } | null;
  columnMonths?: number[] | null;
  weightedAnnualTotal?: number | null;
}

/**
 * One "monthly spend" figure from a budget summary: weighted profiles blend to a typical month
 * (weightedAnnualTotal / 12); others use the single column's totalMonthly.
 */
export function deriveBudgetMonthlyTotal(
  budgetSummary: BudgetMonthlyTotalSource | null | undefined,
): number | null {
  if (!budgetSummary?.result) return null;
  return budgetSummary.columnMonths
    ? (budgetSummary.weightedAnnualTotal ?? 0) / 12
    : budgetSummary.result.totalMonthly;
}

/**
 * Compute the maximum monthly funding available for savings goals.
 * Returns null if inputs are insufficient (no paycheck data or no active earners).
 */
export function computeMaxMonthlyFunding(
  people: CapacityPerson[],
  budgetMonthlyTotal: number,
): number | null {
  const activePeople = people.filter((d) => d.paycheck && d.job);
  if (activePeople.length === 0) return null;

  const monthlyNet = activePeople.reduce((sum, d) => {
    const pc = d.paycheck!;
    const perMonth = d.budgetPerMonth ?? pc.periodsPerYear / 12;
    return sum + pc.netPay * perMonth;
  }, 0);

  return monthlyNet - budgetMonthlyTotal;
}

/**
 * A savings goal's effective monthly contribution: its share of the pool when allocationPercent
 * is set, else the flat fallback. Display and push both use this, since the stored
 * `monthly_contribution` is only a snapshot from the last edit.
 */
export function resolveEffectiveMonthlyContribution(
  allocationPercent: number | null,
  maxMonthlyFunding: number | null,
  fallbackAmount: number,
): number {
  return allocationPercent !== null && maxMonthlyFunding !== null
    ? (allocationPercent / 100) * maxMonthlyFunding
    : fallbackAmount;
}
