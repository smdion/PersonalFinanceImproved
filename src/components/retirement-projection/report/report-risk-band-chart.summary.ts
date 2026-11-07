import type { ChartSummary } from "@/components/charts/chart-summary";
import { compactCurrency } from "@/lib/utils/format";

/** The chart's own axis labels: its first and last year and its top value. */
export function riskBandSummary(
  label: string,
  minYear: number,
  maxYear: number,
  maxValue: number,
): ChartSummary {
  return {
    label,
    text: `${label}, ${minYear} to ${maxYear}, on a scale from $0 to ${compactCurrency(maxValue)}.`,
  };
}
