/**
 * Pure calculator for savings capacity (budget leftover available for savings goals).
 * Extracted from the savings page to enable per-column cross-mode comparison.
 */

/** Minimal person shape needed for capacity calculation. */
export interface CapacityPerson {
  paycheck: { netPay: number; periodsPerYear: number } | null;
  job: unknown | null;
  budgetPerMonth?: number;
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
