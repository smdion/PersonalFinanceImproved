import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatCurrency, formatDate } from "@/lib/utils/format";

/** The fund's balance in the last month shown, and its target line when drawn. */
export function fundMiniSummary(
  balances: readonly number[],
  monthDates: readonly Date[],
  target: number,
) {
  const balance = balances[monthDates.length - 1];
  const values: ShownValue[] = [];
  if (balance !== undefined) values.push(["Balance", formatCurrency(balance)]);
  if (target > 0) values.push(["Target", formatCurrency(target)]);
  return seriesSummary(
    "Fund balance by month",
    monthDates.map((d) => formatDate(d, "short")),
    values,
  );
}
