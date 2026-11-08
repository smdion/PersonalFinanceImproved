import { partsSummary } from "./chart-summary";
import { formatCurrency } from "@/lib/utils/format";

/** A dollar pie: each slice's amount, as its tooltip shows it. */
export function pieSummary(
  label: string,
  slices: readonly { name: string; value: number }[],
) {
  return partsSummary(
    label,
    slices.map((s) => [s.name, formatCurrency(s.value)] as const),
  );
}
