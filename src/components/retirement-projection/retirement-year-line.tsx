/** The projection chart's reference line at the retirement year. */
import { Line } from "recharts";

/** The retirement year's reference line, when the year is charted. */
export function renderRetirementLine(
  chartData: Record<string, string | number>[],
  retYear: number | null,
) {
  const retirementDataIndex = chartData.findIndex(
    (d) => Number(d.year) === retYear,
  );
  if (retirementDataIndex < 0) return null;
  return (
    <Line
      type="monotone"
      yAxisId="balance"
      dataKey={() => undefined}
      stroke="transparent"
      dot={false}
      isAnimationActive={false}
      label={false}
    />
  );
}
