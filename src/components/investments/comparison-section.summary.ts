import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** The last year's deposits, balance and each index run the chart draws. */
export function comparisonSummary(
  points: readonly Record<string, number | string>[],
  shown: readonly { key: string; label: string }[],
) {
  const last = points.at(-1);
  const values: ShownValue[] = [];
  const add = (name: string, v: number | string | undefined) => {
    if (typeof v === "number") values.push([name, formatCurrency(v)]);
  };
  add("What you put in", last?.deposits);
  add("You", last?.you);
  for (const b of shown) add(`Same money in ${b.label}`, last?.[b.key]);
  return seriesSummary(
    "How you did vs the market",
    points.map((p) => String(p.label)),
    values,
  );
}
