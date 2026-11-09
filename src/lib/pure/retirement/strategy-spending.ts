/**
 * What the strategy has the household spend in a retirement year, for every spending reader. A
 * withdrawal-sized year uses `spending` (withdrawal after tax plus Social Security); any other
 * uses `projectedExpenses`, since with gross-up off `spending` is short by the tax on purpose.
 */
export function strategySpending(y: {
  withdrawalSized: boolean;
  spending: number;
  projectedExpenses: number;
}): number {
  return y.withdrawalSized ? y.spending : y.projectedExpenses;
}
