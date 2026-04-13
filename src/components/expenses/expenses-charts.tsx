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

const COLORS = {
  budgeted: "#94a3b8",
  under: "#22c55e",
  over: "#ef4444",
};

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
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => compactCurrency(v)}
          fontSize={10}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          fontSize={10}
          tick={{ fill: "#6b7280" }}
        />
        <RechartsTooltip
          formatter={(value: unknown, name: unknown) => [
            formatCurrency(Number(value)),
            String(name),
          ]}
          labelStyle={{ fontSize: 11, fontWeight: 600 }}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar
          dataKey="budgeted"
          fill={COLORS.budgeted}
          barSize={12}
          radius={[0, 2, 2, 0]}
          name="Budgeted"
        />
        <Bar dataKey="actual" barSize={12} radius={[0, 2, 2, 0]} name="Actual">
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={entry.diff > 0 ? COLORS.over : COLORS.under}
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
          contentStyle={{ fontSize: 11 }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}
