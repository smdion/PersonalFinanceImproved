"use client";

/**
 * Analytics charts — split out and lazy-loaded by analytics-content so the
 * Recharts payload isn't in the analytics page chunk (R31 — the page
 * imported recharts statically).
 */
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { formatPercent, formatDate } from "@/lib/utils/format";
import { computeAllocation } from "@/lib/pure/analytics";
import { CHART_FONT } from "@/components/charts/chart-defaults";
import { sliceColor } from "./slice-color";

type AllocHolding = { assetClassId: number | null; weightBps: number };

export function AllocationDonut({
  holdings,
  assetClassNames,
}: {
  holdings: AllocHolding[];
  assetClassNames: Map<number, string>;
}) {
  const allocation = computeAllocation(holdings);
  if (allocation.size === 0) return null;

  const data = Array.from(allocation.entries()).map(([id, fraction]) => ({
    name: assetClassNames.get(id) ?? `Class ${id}`,
    value: Math.round(fraction * 1000) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
          isAnimationActive={false}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={sliceColor(i)} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [formatPercent(Number(v) / 100, 1), ""]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HistoricalCharts({
  history,
  assetClassNames,
}: {
  history: {
    snapshotId: number;
    snapshotDate: string;
    holdings: AllocHolding[];
  }[];
  assetClassNames: Map<number, string>;
}) {
  if (history.length < 2) return null;

  // Build per-snapshot allocation data for each asset class
  const allClassIds = new Set<number>();
  const points = history.map((snap) => {
    const alloc = computeAllocation(snap.holdings);
    for (const id of alloc.keys()) allClassIds.add(id);
    return { date: snap.snapshotDate, alloc };
  });

  const classIds = Array.from(allClassIds);
  const allocData = points.map(({ date, alloc }) => {
    const row: Record<string, number | string> = {
      date: formatDate(date, "short"),
    };
    for (const id of classIds) {
      row[assetClassNames.get(id) ?? `Class ${id}`] =
        Math.round((alloc.get(id) ?? 0) * 1000) / 10;
    }
    return row;
  });

  const classNames = classIds.map(
    (id) => assetClassNames.get(id) ?? `Class ${id}`,
  );

  return (
    <Card title="Historical Allocation" isCollapsible isDefaultOpen={false}>
      <div className="text-faint mb-2 text-xs">
        % allocation by asset class across snapshots
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={allocData}>
          <XAxis dataKey="date" tick={{ fontSize: CHART_FONT.tick }} />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: CHART_FONT.tick }}
            width={36}
          />
          <Tooltip formatter={(v) => [formatPercent(Number(v) / 100, 1), ""]} />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: CHART_FONT.legend }}
          />
          {classNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={sliceColor(i)}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
