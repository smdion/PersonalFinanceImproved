import {
  seriesSummary,
  type ShownValue,
} from "@/components/charts/chart-summary";
import { formatPercent } from "@/lib/utils/format";

/** Each class's share at the last age, and Vanguard's stock share when drawn. */
export function glidePathSummary(
  points: readonly { age: number; vanguard: number | null }[],
  classes: readonly { assetClassId: number; name: string }[],
  key: (assetClassId: number) => string,
) {
  const last: Record<string, unknown> | undefined = points.at(-1);
  const values: ShownValue[] = classes.flatMap((c) => {
    const share = last?.[key(c.assetClassId)];
    return typeof share === "number"
      ? [[c.name, formatPercent(share / 100)] as const]
      : [];
  });
  const vanguard = points.at(-1)?.vanguard;
  if (vanguard != null)
    values.push(["Vanguard target-date stocks", formatPercent(vanguard / 100)]);
  return seriesSummary(
    "Target mix by age",
    points.map((p) => `Age ${p.age}`),
    values,
  );
}
