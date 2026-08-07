"use client";

/** Recharts-heavy chart row for the expenses page. Lives in its own module
 *  so the parent page can next/dynamic-import it and avoid pulling ~250KB
 *  of recharts into the page bundle (v0.5 expert-review M8). */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { formatCurrency, compactCurrency } from "@/lib/utils/format";
import {
  CHART_FONT,
  gridProps,
  axisProps,
  yAxisProps,
  tooltipProps,
  legendProps,
} from "@/components/charts/chart-defaults";
import { CHART_COLORS } from "@/lib/utils/colors";

export type GroupSummaryRow = {
  name: string;
  budgeted: number;
  actual: number;
  diff: number;
};

export type SpendingPieSlice = {
  name: string;
  value: number;
  color: string | undefined;
};

export function BudgetVsActualBar({
  data,
}: {
  data: readonly GroupSummaryRow[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
      <BarChart
        data={[...data]}
        layout="vertical"
        margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
      >
        <CartesianGrid {...gridProps} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => compactCurrency(v)}
          {...axisProps}
        />
        <YAxis
          type="category"
          dataKey="name"
          {...yAxisProps}
          width={120}
          tick={{ ...yAxisProps.tick, fill: CHART_COLORS.axisMuted }}
        />
        <RechartsTooltip
          formatter={(value: unknown, name: unknown) => [
            formatCurrency(Number(value)),
            String(name),
          ]}
          labelStyle={{ fontSize: CHART_FONT.legend, fontWeight: 600 }}
          {...tooltipProps}
        />
        <Bar
          dataKey="budgeted"
          fill={CHART_COLORS.expenseBudgeted}
          barSize={12}
          radius={[0, 2, 2, 0]}
          name="Budgeted"
        />
        <Bar dataKey="actual" barSize={12} radius={[0, 2, 2, 0]} name="Actual">
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={
                entry.diff > 0
                  ? CHART_COLORS.expenseOver
                  : CHART_COLORS.expenseUnder
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SpendingPie({ data }: { data: readonly SpendingPieSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={[...data]}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <RechartsTooltip
          formatter={(value: unknown) => formatCurrency(Number(value))}
          {...tooltipProps}
        />
        <Legend {...legendProps} iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}
