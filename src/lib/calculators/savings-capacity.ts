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

/** Minimal goal shape needed for allocation total. */
export interface SavingsGoalForAllocation {
  isActive: boolean;
  monthlyContribution: number | string;
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
 * Sum monthly contributions across all active savings goals with a contribution > 0.
 * Single source of truth used by both the savings page and budget page warnings.
 */
export function computeTotalMonthlyAllocation(
  goals: SavingsGoalForAllocation[],
): number {
  return goals
    .filter((g) => g.isActive && Number(g.monthlyContribution) > 0)
    .reduce((s, g) => s + Number(g.monthlyContribution), 0);
}

/**
 * Effective monthly contribution for a savings goal: percentage-of-pool
 * when the goal has allocationPercent set, otherwise the flat fallback
 * amount (the goal's stored monthlyContribution).
 *
 * Shared by the savings page display (what you see) and the push-to-API
 * server logic (what gets pushed to YNAB) — a percentage-based goal's
 * dollar amount moves whenever the underlying pool (paycheck/budget
 * totals) changes, but `savings_goals.monthly_contribution` is only a
 * point-in-time snapshot, last written whenever the goal was edited. If
 * push read that stale column directly, it would silently push an amount
 * that no longer matches what's shown on screen — this keeps both
 * derivations identical so they can't drift apart.
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
