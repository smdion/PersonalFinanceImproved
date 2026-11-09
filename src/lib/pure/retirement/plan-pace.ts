/**
 * Where the plan expected the money to be today: the last finalized year's ending balance grown
 * at the plan's return for the year so far, plus that part's planned contributions (half-grown on
 * average). A projection starts from today's balances, so it can't answer this.
 */
import { MS_PER_DAY } from "@/lib/constants";

/** Share of `year` gone by at the end of `day` (YYYY-MM-DD). */
export function yearFraction(day: string, year: number): number {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const at = Date.parse(`${day}T00:00:00Z`) + MS_PER_DAY;
  return Math.min(1, Math.max(0, (at - start) / (end - start)));
}

export function planExpectedNow(args: {
  yearStartBalance: number;
  /** The plan's annual return this year. */
  annualRate: number;
  /** The plan's contributions for the whole year, employer included. */
  yearContributions: number;
  /** Share of the year gone by. */
  fraction: number;
}): number {
  const { yearStartBalance, annualRate, yearContributions, fraction } = args;
  const growth = (share: number) => Math.pow(1 + annualRate, share);
  return (
    yearStartBalance * growth(fraction) +
    yearContributions * fraction * growth(fraction / 2)
  );
}
