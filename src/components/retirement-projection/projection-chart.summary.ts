import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** The last year's balances, typical outcome and income, named and shown as its tooltip does. */
export function balanceSummary(
  points: readonly Record<string, number | string>[],
  segments: readonly { key: string; label: string }[],
) {
  const last = points.at(-1);
  const values: ShownValue[] = [];
  const add = (name: string, key: string, suffix = "") => {
    const v = last?.[key];
    if (typeof v === "number" && v > 0)
      values.push([name, `${formatCurrency(v)}${suffix}`]);
  };
  for (const s of segments) add(s.label, s.key);
  if (typeof last?.mc_p50 === "number")
    values.push(["Typical outcome", formatCurrency(last.mc_p50)]);
  add("Portfolio withdrawal", "_totalWithdrawal", "/yr");
  add("Social Security", "_ssIncome", "/yr");
  return seriesSummary(
    "Balance projection",
    points.map((p) => String(p.year)),
    values,
  );
}
