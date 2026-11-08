import type { ChartSummary } from "@/components/charts/chart-summary";
import { formatPercent } from "@/lib/utils/format";

/** What the bar's own hover titles say: the employee share of the IRS limit,
 *  and the employer match drawn beyond it when it doesn't count. */
export function fundingBarSummary(
  pct: number,
  showMatchBeyond: boolean,
): ChartSummary {
  const employee = `Employee contribution: ${formatPercent(pct)} of IRS limit.`;
  return {
    label: "Funding toward the IRS limit",
    text: showMatchBeyond
      ? `${employee} Employer match shown beyond it (does not count toward IRS limit).`
      : employee,
  };
}
