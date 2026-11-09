import { safeDivide } from "@/lib/utils/math";

/**
 * A strategy's summary figures for the comparison table. Each year is put in
 * the display's dollars by that year's own deflator before it's averaged or
 * compared: a 40-year-out Legacy balance deflated from the retirement year
 * reads about twice what it's worth today.
 */
type StrategyYear = {
  year: number;
  withdrawal: number;
  spending: number;
  retirementBalance: number;
};

export function strategySummary(
  years: readonly StrategyYear[],
  toDisplay: (value: number, year: number) => number,
) {
  const spending = years.map((y) => toDisplay(y.spending, y.year));
  const withdrawals = years.map((y) => toDisplay(y.withdrawal, y.year));
  const average = (xs: number[]) =>
    safeDivide(
      xs.reduce((t, x) => t + x, 0),
      xs.length,
      0,
    );
  const last = years.at(-1);
  return {
    year1Spending: spending[0] ?? 0,
    avgSpending: average(spending),
    year1Withdrawal: withdrawals[0] ?? 0,
    avgWithdrawal: average(withdrawals),
    minWithdrawal: withdrawals.length > 0 ? Math.min(...withdrawals) : 0,
    maxWithdrawal: withdrawals.length > 0 ? Math.max(...withdrawals) : 0,
    legacy: last ? toDisplay(last.retirementBalance, last.year) : 0,
  };
}
