"use client";

/**
 * The target mix by age — the glide path the Benchmarks targets come from —
 * stacked by asset class, with Vanguard Target Retirement's stock share
 * (shifted to the household's retirement age) as a dashed line on top of
 * the stock bands, and markers at today and at retirement.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/lib/utils/colors";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { formatPercent } from "@/lib/utils/format";
import {
  glidePathSeries,
  vanguardStockShare,
  type GlidePathPoint,
} from "@/lib/pure/glide-path-chart";

export type GlidePathClass = {
  assetClassId: number;
  name: string;
  color: string;
  isStock: boolean;
};

const START_AGE = 25;
const END_AGE = 95;

export function GlidePathChart({
  path,
  classes,
  age,
  retirementAge,
}: {
  path: GlidePathPoint[];
  /** Stack order, bottom first: stocks, then bonds, then cash. */
  classes: GlidePathClass[];
  age: number | null;
  retirementAge: number | null;
}) {
  const series = glidePathSeries(path, START_AGE, END_AGE);
  if (series.length === 0 || classes.length === 0) return null;
  const key = (id: number) => `c${id}`;
  const data = series.map((p) => ({
    age: p.age,
    ...Object.fromEntries(
      classes.map((c) => [
        key(c.assetClassId),
        (p.shares[c.assetClassId] ?? 0) * 100,
      ]),
    ),
    vanguard:
      retirementAge !== null
        ? vanguardStockShare(p.age, retirementAge) * 100
        : null,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.mcGrid} />
          <XAxis
            dataKey="age"
            type="number"
            domain={[START_AGE, END_AGE]}
            ticks={[25, 35, 45, 55, 65, 75, 85, 95]}
            tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.mcAxis }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => formatPercent(v / 100)}
            tick={{ fontSize: CHART_FONT.tick, fill: CHART_COLORS.mcAxis }}
            width={40}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof data)[number];
              const stocks = classes
                .filter((c) => c.isStock)
                .reduce(
                  (s, c) =>
                    s +
                    ((p as Record<string, unknown>)[
                      key(c.assetClassId)
                    ] as number),
                  0,
                );
              return (
                <div className="bg-surface-primary rounded-lg border p-2.5 text-xs shadow-lg">
                  <div className="text-primary mb-1 font-medium">
                    Age {p.age}
                  </div>
                  {[...classes].reverse().map((c) => (
                    <div
                      key={c.assetClassId}
                      className="flex justify-between gap-4"
                    >
                      <span className="text-secondary flex items-center gap-1">
                        <span
                          className="inline-block h-2 w-2 rounded-sm"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                      <span className="text-primary">
                        {formatPercent(
                          ((p as Record<string, unknown>)[
                            key(c.assetClassId)
                          ] as number) / 100,
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="border-subtle mt-1 flex justify-between gap-4 border-t pt-1">
                    <span className="text-muted">Stocks</span>
                    <span className="text-primary">
                      {formatPercent(stocks / 100)}
                    </span>
                  </div>
                  {p.vanguard !== null && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">
                        Vanguard target-date stocks
                      </span>
                      <span className="text-primary">
                        {formatPercent(p.vanguard / 100)}
                      </span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          {classes.map((c) => (
            <Area
              key={c.assetClassId}
              type="linear"
              dataKey={key(c.assetClassId)}
              stackId="mix"
              stroke="var(--surface-primary, #ffffff)"
              strokeWidth={1}
              fill={c.color}
              fillOpacity={0.85}
              isAnimationActive={false}
            />
          ))}
          {retirementAge !== null && (
            <Line
              type="linear"
              dataKey="vanguard"
              stroke={CHART_COLORS.mcAxis}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {age !== null && (
            <ReferenceLine
              x={age}
              stroke={CHART_COLORS.mcAxis}
              label={{
                value: "Now",
                position: "insideTopLeft",
                fontSize: CHART_FONT.label,
                fill: CHART_COLORS.mcAxis,
              }}
            />
          )}
          {retirementAge !== null && (
            <ReferenceLine
              x={retirementAge}
              stroke={CHART_COLORS.mcAxis}
              strokeDasharray="2 2"
              label={{
                value: "Retire",
                position: "insideTopLeft",
                fontSize: CHART_FONT.label,
                fill: CHART_COLORS.mcAxis,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      <ul className="text-caption text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {classes.map((c) => (
          <li key={c.assetClassId} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: c.color }}
            />
            {c.name}
          </li>
        ))}
        {retirementAge !== null && (
          <li className="flex items-center gap-1">
            <span
              className="inline-block w-4 border-t-2 border-dashed"
              style={{ borderColor: CHART_COLORS.mcAxis }}
            />
            Vanguard target-date stocks (retiring at {retirementAge})
          </li>
        )}
      </ul>
    </div>
  );
}
