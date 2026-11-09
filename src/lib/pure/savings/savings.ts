/**
 * Savings tracker: active goals' shares of the monthly savings pool (budget income minus
 * expenses), warning when allocations don't sum to 100%; months to each target (null at $0), and
 * months of essential expenses covered for the `isEmergencyFund` goal.
 */
import type { SavingsInput, SavingsResult } from "./savings.types";
import { formatPercent } from "../../utils/format";
import { safeDivide, sumBy, roundToCents } from "../../utils/math";
import { ALLOCATION_TOLERANCE } from "../../constants";

export function calculateSavings(input: SavingsInput): SavingsResult {
  const warnings: string[] = [];
  const { goals, monthlySavingsPool, essentialMonthlyExpenses } = input;

  const activeGoals = goals.filter((g) => g.isActive);
  const totalSaved = roundToCents(sumBy(activeGoals, (g) => g.currentBalance));

  // Sanity check: allocation percentages should sum to 100% (1.0 as decimal)
  // Allows 1% tolerance for rounding. Warns but doesn't fail — user can fix in the UI.
  const totalAllocation = sumBy(activeGoals, (g) => g.allocationPercent);
  if (
    activeGoals.length > 0 &&
    Math.abs(totalAllocation - 1) > ALLOCATION_TOLERANCE
  ) {
    warnings.push(
      `Allocation percentages sum to ${formatPercent(totalAllocation, 1)}, expected 100%`,
    );
  }

  // Emergency fund: how many months of essential expenses does the e-fund cover?
  // Uses essentialMonthlyExpenses from the budget calculator (not total expenses).
  const efundGoal = activeGoals.find((g) => g.isEmergencyFund);
  const efundMonthsCovered = efundGoal
    ? Number(safeDivide(efundGoal.currentBalance, essentialMonthlyExpenses))
    : null;

  // Per-goal breakdown
  const goalResults = activeGoals.map((g) => {
    // Monthly allocation = savings pool × this goal's percentage share
    const monthlyAllocation = roundToCents(
      monthlySavingsPool * g.allocationPercent,
    );
    const remaining = Math.max(0, g.targetBalance - g.currentBalance);
    // Months to target: simple linear projection (no interest/growth assumed for savings goals)
    // Returns null if monthly allocation is $0 (goal won't be reached at current rate)
    // Returns 0 if already at or above target
    const monthsToTarget =
      remaining <= 0
        ? 0
        : monthlyAllocation > 0
          ? Math.ceil(remaining / monthlyAllocation)
          : null;

    return {
      goalId: g.id,
      name: g.name,
      current: g.currentBalance,
      target: g.targetBalance,
      monthlyAllocation,
      progress: Number(safeDivide(g.currentBalance, g.targetBalance)),
      monthsToTarget,
    };
  });

  return {
    efundMonthsCovered,
    totalSaved,
    goals: goalResults,
    warnings,
  };
}
