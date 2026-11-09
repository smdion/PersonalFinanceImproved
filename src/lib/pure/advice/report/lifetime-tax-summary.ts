/** Lifetime tax totals over decumulation years, shared by the Lifetime Tax Paid card and
 *  the advisor report. Accumulation years have no per-year tax cost to sum. */
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";

type LifetimeTaxDecade = {
  /** e.g. "50s" for ages 50-59. */
  label: string;
  /** e.g. 50 for "50s" — sort key, since string labels sort wrong past 100
   *  ("100s".localeCompare("50s") < 0, so a plan reaching age 100 rendered
   *  100s before 50s). */
  decadeStart: number;
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
  /** Sorted by decadeStart ascending. Always present, even for a
   *  single-decade retirement — callers decide whether a one-row
   *  breakdown is worth rendering. */
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

  for (const yearRow of decumulationYears) {
    const taxToday = deflate(yearRow.taxCost, yearRow.year);
    const withdrawalToday = deflate(yearRow.totalWithdrawal, yearRow.year);
    totalTaxToday += taxToday;
    totalWithdrawalToday += withdrawalToday;

    const decadeStart = Math.floor(yearRow.age / 10) * 10;
    const existing = buckets.get(decadeStart);
    if (existing) {
      existing.taxToday += taxToday;
      existing.withdrawalToday += withdrawalToday;
      existing.years += 1;
    } else {
      buckets.set(decadeStart, {
        label: `${decadeStart}s`,
        decadeStart,
        taxToday,
        withdrawalToday: withdrawalToday,
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
    decades: Array.from(buckets.values()).sort(
      (a, b) => a.decadeStart - b.decadeStart,
    ),
  };
}
