import { seriesSummary } from "@/components/charts/chart-summary";
import { formatCurrency, formatDate } from "@/lib/utils/format";

/** Each fund's balance in the last month shown (a point holds `month` and one value per fund). */
export function trajectorySummary(
  points: readonly { month: string; [fund: string]: number | string }[],
) {
  const last = points.at(-1);
  return seriesSummary(
    "Goal trajectories",
    points.map((p) => formatDate(`${p.month}-01`, "short")),
    Object.entries(last ?? {}).flatMap(([name, value]) =>
      typeof value === "number" ? [[name, formatCurrency(value)] as const] : [],
    ),
  );
}
