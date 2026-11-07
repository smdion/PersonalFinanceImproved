import { seriesSummary } from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";
import type { ChartMetric } from "./withdrawal-comparison.model";

/** Each strategy's line in the last year, for the metric the chart shows. */
export function strategyLinesSummary(
  rows: readonly Record<string, number>[],
  strategies: readonly { strategy: string; shortLabel: string }[],
  metric: ChartMetric,
) {
  const last = rows.at(-1);
  return seriesSummary(
    metric === "retirementBalance"
      ? "Portfolio balance by strategy"
      : "Annual withdrawal by strategy",
    rows.map((r) => String(r.year)),
    strategies.flatMap((s) => {
      const v = last?.[s.strategy];
      return v === undefined
        ? []
        : [[s.shortLabel, formatCurrency(v)] as const];
    }),
  );
}
