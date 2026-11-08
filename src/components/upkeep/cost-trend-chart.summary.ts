import { seriesSummary } from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** Years in order, and the last year's total as its tooltip shows it. */
export function costTrendSummary(
  years: readonly { year: number; cost: number }[],
) {
  const last = years.at(-1);
  return seriesSummary(
    "Annual utility cost",
    years.map((y) => String(y.year)),
    last ? [["Year total", formatCurrency(last.cost)]] : [],
  );
}
