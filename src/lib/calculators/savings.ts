/**
 * Savings Tracker Calculator
 *
 * Tracks progress toward any number of savings goals with percentage-based allocation from a
 * shared monthly savings pool.
 *
 * Key concepts:
 *   - **Monthly savings pool**: comes from the budget calculator (total income minus expenses).
 *     This is NOT hardcoded — it's whatever the budget says is available for savings.
 *   - **Allocation percentages**: each goal gets a share of the pool (e.g. e-fund 50%, vacation 30%,
 *     car 20%). Users can change these at any time. The calculator warns if they don't sum to 100%.
 *   - **Emergency fund**: one goal can be flagged as `isEmergencyFund`. For this goal, the
 *     calculator also reports how many months of essential expenses it covers (e.g. 3.2 months).
 *     Essential expenses come from the budget calculator's essentialTotal.
 *   - **Months to target**: for each goal, estimates how many months until the target is reached
 *     at the current monthly allocation rate. Returns null if allocation is $0 (can't compute).
 *   - **Active/inactive goals**: only active goals are included in calculations. Users can pause
 *     goals without deleting them.
 *
 * All values are user-editable at any time — goals, targets, allocations, and the savings pool
 * can all be changed and the calculator re-runs with the new values.
 */
import type { SavingsInput, SavingsResult } from "./types";
import { safeDivide, sumBy, roundToCents } from "../utils/math";
import { ALLOCATION_TOLERANCE } from "../constants";

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
      `Allocation percentages sum to ${(totalAllocation * 100).toFixed(1)}%, expected 100%`,
    );
  }

  // Emergency fund: how many months of essential expenses does the e-fund cover?
  // Uses essentialMonthlyExpenses from the budget calculator (not total expenses).
  const efundGoal = activeGoals.find((g) => g.isEmergencyFund);
  const efundMonthsCovered = efundGoal
    ? Number(
        safeDivide(efundGoal.currentBalance, essentialMonthlyExpenses) ?? 0,
      )
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
      progress: Number(safeDivide(g.currentBalance, g.targetBalance) ?? 0),
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
