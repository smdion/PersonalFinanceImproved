/** Static, print-safe rendering of the Monte Carlo percentile-band fan
 *  chart — plain inline SVG, not Recharts/canvas (correction from the
 *  advisor-report plan: print output can't depend on an interactive chart
 *  library). Presentational only; `buildRiskBandPoints` (lib/pure/report/
 *  risk-narrative.ts) already shaped the data. */
import { compactCurrency } from "@/lib/utils/format";
import type { RiskBandPoint } from "@/lib/pure/report/risk-narrative";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_LEFT = 56;
const PAD_BOTTOM = 24;
const PAD_TOP = 12;
const PAD_RIGHT = 12;

export function ReportRiskBandChart({
  points,
  deflate,
}: {
  points: RiskBandPoint[];
  deflate: (value: number, year: number) => number;
}) {
  if (points.length === 0) return null;

  const deflated = points.map((p) => ({
    year: p.year,
    low: deflate(p.low, p.year),
    high: deflate(p.high, p.year),
    median: deflate(p.median, p.year),
  }));

  const minYear = deflated[0]!.year;
  const maxYear = deflated[deflated.length - 1]!.year;
  const maxValue = Math.max(...deflated.map((p) => p.high), 0);
  const minValue = Math.min(0, ...deflated.map((p) => p.low));

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (year: number) =>
    PAD_LEFT +
    (maxYear === minYear
      ? 0
      : ((year - minYear) / (maxYear - minYear)) * plotWidth);
  const y = (value: number) =>
    PAD_TOP +
    plotHeight -
    (maxValue === minValue
      ? 0
      : ((value - minValue) / (maxValue - minValue)) * plotHeight);

  const areaPath =
    deflated.map((p) => `${x(p.year)},${y(p.high)}`).join(" L ") +
    " L " +
    [...deflated]
      .reverse()
      .map((p) => `${x(p.year)},${y(p.low)}`)
      .join(" L ");
  const medianPath = deflated
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)},${y(p.median)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Portfolio balance range across simulated market conditions, 10th to 90th percentile, with median"
      className="w-full h-auto"
    >
      {/* Zero line */}
      <line
        x1={PAD_LEFT}
        y1={y(0)}
        x2={WIDTH - PAD_RIGHT}
        y2={y(0)}
        stroke="currentColor"
        strokeOpacity={0.2}
      />
      {/* p10-p90 shaded range */}
      <path d={`M ${areaPath} Z`} fill="currentColor" fillOpacity={0.15} />
      {/* Median line */}
      <path
        d={medianPath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      {/* Axis labels: first/last year, max value */}
      <text x={PAD_LEFT} y={HEIGHT - 6} fontSize={10} fill="currentColor">
        {minYear}
      </text>
      <text
        x={WIDTH - PAD_RIGHT}
        y={HEIGHT - 6}
        fontSize={10}
        fill="currentColor"
        textAnchor="end"
      >
        {maxYear}
      </text>
      <text x={4} y={PAD_TOP + 8} fontSize={10} fill="currentColor">
        {compactCurrency(maxValue)}
      </text>
      <text x={4} y={y(0) + 4} fontSize={10} fill="currentColor">
        $0
      </text>
    </svg>
  );
}
