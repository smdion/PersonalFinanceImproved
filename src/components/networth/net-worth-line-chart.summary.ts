import { seriesSummary } from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";
import type { HistoryRow } from "./types";

/** By year, or by age when the chart's rows carry `displayAge`. */
export function netWorthLineSummary(rows: readonly HistoryRow[]) {
  const last = rows.at(-1);
  return seriesSummary(
    "Net worth over time",
    rows.map((r) =>
      r.displayAge === undefined
        ? String(r.year)
        : `Age ${String(r.displayAge)}`,
    ),
    last
      ? [
          ["Net Worth", formatCurrency(last.netWorth)],
          ["Portfolio", formatCurrency(last.portfolioTotal)],
          ["House", formatCurrency(last.houseValue)],
          ["Cash", formatCurrency(last.cash)],
          ["Liabilities", formatCurrency(last.totalLiabilities)],
        ]
      : [],
  );
}
