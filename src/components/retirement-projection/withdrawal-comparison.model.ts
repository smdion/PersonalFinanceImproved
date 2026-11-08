export type ChartMetric = "retirementBalance" | "withdrawal";

/** One row per year: each strategy's balance or withdrawal, in the shown dollars. */
export function strategyChartRows(
  strategies: readonly {
    strategy: string;
    yearByYear: readonly {
      year: number;
      retirementBalance: number;
      withdrawal: number;
    }[];
  }[],
  chartMetric: ChartMetric,
  deflate: (value: number, year: number) => number,
) {
  const byYear = new Map<number, Record<string, number>>();
  for (const s of strategies) {
    for (const pt of s.yearByYear) {
      if (!byYear.has(pt.year)) byYear.set(pt.year, { year: pt.year });
      const raw =
        chartMetric === "retirementBalance"
          ? pt.retirementBalance
          : pt.withdrawal;
      byYear.get(pt.year)![s.strategy] = deflate(raw, pt.year);
    }
  }
  return Array.from(byYear.values()).sort(
    (a, b) => (a.year ?? 0) - (b.year ?? 0),
  );
}
