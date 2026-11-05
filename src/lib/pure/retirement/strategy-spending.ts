/**
 * What the strategy has the household spend in a retirement year — the one
 * figure every "spending" reader compares (Coast FIRE, the Simulation's
 * stability checks, the stability chart, the bridge, the starting-income
 * tile). A withdrawal-sized year (a portfolio-sized strategy with Social
 * Security on top) has no spending figure of its own: it's what the
 * withdrawal delivers after tax plus Social Security (`spending`). Every
 * other year it's the strategy's own spending figure, `projectedExpenses`
 * — unchanged by tax handling (with "gross up for taxes" off, `spending`
 * is short by the tax on purpose, which isn't the strategy cutting).
 */
export function strategySpending(y: {
  withdrawalSized: boolean;
  spending: number;
  projectedExpenses: number;
}): number {
  return y.withdrawalSized ? y.spending : y.projectedExpenses;
}
