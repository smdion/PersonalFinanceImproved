import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatPercent } from "@/lib/utils/format";

/** The last year's ratio and Simulation lines, as the tooltip shows them (points hold percents). */
export function stabilitySummary(
  points: readonly Record<string, number | undefined>[],
  baselineLabel: string,
) {
  const last = points.at(-1);
  const values: ShownValue[] = [];
  if (last?.ratio !== undefined) {
    values.push([`vs ${baselineLabel}`, formatPercent(last.ratio / 100, 1)]);
    if (last.mc_p50 !== undefined)
      values.push(["Sim. median", formatPercent(last.mc_p50 / 100, 1)]);
    if (last.mc_breach !== undefined && last.mc_breach > 0)
      values.push([
        "Breached floor",
        `${formatPercent(last.mc_breach / 100, 1)} of sims`,
      ]);
  }
  return seriesSummary(
    `Yearly income stability vs ${baselineLabel}`,
    points.map((p) => String(p.year)),
    values,
  );
}
