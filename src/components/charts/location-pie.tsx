"use client";

/** A dollar pie beside its legend: each slice's share of `total` and amount. */
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { CHART_FONT } from "./chart-defaults";
import { ChartFrame } from "./chart-frame";
import { pieSummary } from "./pie.summary";

export function LocationPie({
  label,
  data,
  total,
}: {
  label: string;
  data: { name: string; value: number; color: string }[];
  total: number;
}) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="w-full sm:w-1/2">
        <ChartFrame summary={pieSummary(label, data)} height={200}>
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              paddingAngle={2}
              label={false}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <RechartsTooltip
              formatter={(value) => formatCurrency(Number(value))}
              contentStyle={{ fontSize: CHART_FONT.tooltip }}
            />
          </PieChart>
        </ChartFrame>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div
            key={d.name}
            className="flex items-center justify-between text-sm"
          >
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-muted">{d.name}</span>
            </span>
            <div className="text-right">
              <span className="font-medium">
                {formatPercent(safeDivide(d.value, total, 0))}
              </span>
              <span className="text-faint ml-2 text-xs">
                {formatCurrency(d.value)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
