/** Lifetime tax totals across decumulation years — shared by the on-screen
 *  Lifetime Tax Paid card (tax-summary-card.tsx) and the advisor report's
 *  own tax section, so the two can never disagree (RULES.md single
 *  computation path). Decumulation only: EngineDecumulationYear.taxCost is
 *  computed per year and ready to sum; EngineAccumulationYear has no
 *  equivalent field — see tax-summary-card.tsx's docblock and
 *  .scratch/docs/plans/TODO.md for why accumulation isn't included. */
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";

export type LifetimeTaxDecade = {
  /** e.g. "50s" for ages 50-59. */
  label: string;
  taxToday: number;
  withdrawalToday: number;
  years: number;
};

export type LifetimeTaxSummary = {
  totalTaxToday: number;
  totalWithdrawalToday: number;
  /** totalTaxToday / totalWithdrawalToday, 0 if nothing was withdrawn. */
  weightedRate: number;
  yearsCovered: number;
  /** Sorted by decade label ascending. Only present when there's real
   *  multi-decade data (a single-decade retirement has nothing to break
   *  down). */
  decades: LifetimeTaxDecade[];
};

export function computeLifetimeTaxSummary(
  decumulationYears: EngineDecumulationYear[],
  deflate: (value: number, year: number) => number,
): LifetimeTaxSummary | null {
  if (decumulationYears.length === 0) return null;

  let totalTaxToday = 0;
  let totalWithdrawalToday = 0;
  const buckets = new Map<number, LifetimeTaxDecade>();

  for (const yr of decumulationYears) {
    const taxToday = deflate(yr.taxCost, yr.year);
    const wdToday = deflate(yr.totalWithdrawal, yr.year);
    totalTaxToday += taxToday;
    totalWithdrawalToday += wdToday;

    const decadeStart = Math.floor(yr.age / 10) * 10;
    const existing = buckets.get(decadeStart);
    if (existing) {
      existing.taxToday += taxToday;
      existing.withdrawalToday += wdToday;
      existing.years += 1;
    } else {
      buckets.set(decadeStart, {
        label: `${decadeStart}s`,
        taxToday,
        withdrawalToday: wdToday,
        years: 1,
      });
    }
  }

  return {
    totalTaxToday,
    totalWithdrawalToday,
    weightedRate:
      totalWithdrawalToday > 0 ? totalTaxToday / totalWithdrawalToday : 0,
    yearsCovered: decumulationYears.length,
    decades: Array.from(buckets.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  };
}
