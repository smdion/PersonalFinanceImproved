import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

type JourneyPoint = {
  year: number;
  age: number;
  netWorth: number;
  portfolio: number;
  avgWealth: number;
  prodigiousWealth: number;
};

/** The benchmark lines are named only when the chart draws them. */
export function journeySummary(
  points: readonly JourneyPoint[],
  byYear: boolean,
  hasIncome: boolean,
) {
  const last = points.at(-1);
  const values: ShownValue[] = [];
  if (last && hasIncome)
    values.push(
      ["Avg Wealth", formatCurrency(last.avgWealth)],
      ["Prodigious Wealth", formatCurrency(last.prodigiousWealth)],
    );
  if (last)
    values.push(
      ["Portfolio", formatCurrency(last.portfolio)],
      ["Net Worth", formatCurrency(last.netWorth)],
    );
  return seriesSummary(
    "Journey to abundance",
    points.map((p) => (byYear ? String(p.year) : `Age ${p.age}`)),
    values,
  );
}
