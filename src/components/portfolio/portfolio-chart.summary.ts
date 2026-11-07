import { seriesSummary } from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** The last point's value: a snapshot total, or the live estimate after it. */
export function portfolioSummary(
  points: readonly { label: string; total: number | null; live?: number }[],
) {
  const last = points.at(-1);
  return seriesSummary(
    "Portfolio value",
    points.map((p) => p.label),
    last?.total != null
      ? [["Total", formatCurrency(last.total)]]
      : last?.live !== undefined
        ? [["Live estimate", `≈ ${formatCurrency(last.live)}`]]
        : [],
  );
}

/** Each account's amount on the last date, as the stacked tooltip lists it. */
export function stackedSummary(
  rows: readonly (Record<string, number | string> & { label: string })[],
  series: readonly { key: string; label: string }[],
) {
  const last = rows.at(-1);
  return seriesSummary(
    "Portfolio value by account",
    rows.map((r) => r.label),
    series.flatMap((s) => {
      const v = last?.[s.key];
      return typeof v === "number"
        ? [[s.label, formatCurrency(v)] as const]
        : [];
    }),
  );
}
