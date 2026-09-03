"use client";

/**
 * Annual utility cost trend (one bar per year). Split into its own module
 * and lazy-loaded by upkeep/utilities so the Recharts payload isn't in the
 * page chunk (R31 — the page imported recharts statically).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, compactCurrency } from "@/lib/utils/format";
import { gridProps, axisProps } from "@/components/charts";

/** Minimal per-year shape this chart needs — decoupled from the page's
 *  fuller UtilityYearRow. */
export type CostTrendYear = {
  year: number;
  totalCost: number;
  totalUsage: number | null;
  costPerUnit: number | null;
};

export function CostTrendChart({
  years,
  color,
  unit,
}: {
  years: CostTrendYear[];
  color: string;
  unit: string;
}) {
  const data = years
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: y.year,
      cost: Math.round(y.totalCost),
      usage: y.totalUsage,
      costPerUnit: y.costPerUnit,
    }));

  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="year" {...axisProps} />
          <YAxis
            {...axisProps}
            width={48}
            tickFormatter={(v: number) => compactCurrency(v)}
          />
          <RechartsTooltip
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            formatter={(value, _name, item) => {
              const p = item?.payload as {
                usage: number | null;
                costPerUnit: number | null;
              };
              const parts = [formatCurrency(Number(value))];
              if (p?.usage != null)
                parts.push(`${p.usage.toLocaleString()} ${unit}`);
              if (p?.costPerUnit != null)
                parts.push(`${formatCurrency(p.costPerUnit)}/${unit}`);
              return [parts.join("  ·  "), "Year total"];
            }}
          />
          <Bar
            dataKey="cost"
            radius={[3, 3, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.year} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
