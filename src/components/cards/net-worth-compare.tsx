"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";

type PresetKey = "1m" | "3m" | "6m" | "ytd" | "1y" | "yoy" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "1m", label: "1 Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "1 Year" },
  { key: "yoy", label: "Year vs Year" },
  { key: "custom", label: "Custom" },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetDates(preset: PresetKey): { from: string; to: string } {
  const now = new Date();
  const to = toDateStr(now);
  switch (preset) {
    case "1m": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return { from: toDateStr(d), to };
    }
    case "3m": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      return { from: toDateStr(d), to };
    }
    case "6m": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return { from: toDateStr(d), to };
    }
    case "ytd": {
      return { from: `${now.getFullYear()}-01-01`, to };
    }
    case "1y": {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return { from: toDateStr(d), to };
    }
    case "custom":
    default: {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return { from: toDateStr(d), to };
    }
  }
}

export function NetWorthCompare({
  availableYears,
  useMarketValue = true,
}: {
  availableYears?: number[];
  useMarketValue?: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    if (availableYears && availableYears.length > 0)
      return [...availableYears].sort((a, b) => a - b);
    // Fallback: generate a range from 2015 to current year
    const result: number[] = [];
    for (let y = 2015; y <= currentYear; y++) result.push(y);
    return result;
  }, [availableYears, currentYear]);

  const [activePreset, setActivePreset] = useState<PresetKey>("1y");
  const presetDates = useMemo(
    () => getPresetDates(activePreset),
    [activePreset],
  );
  const [customFrom, setCustomFrom] = useState(presetDates.from);
  const [customTo, setCustomTo] = useState(presetDates.to);
  const [yoyFrom, setYoyFrom] = useState(
    years.length >= 2 ? years[years.length - 2]! : currentYear - 1,
  );
  const [yoyTo, setYoyTo] = useState(years[years.length - 1]!);

  const dateFrom =
    activePreset === "yoy"
      ? `${yoyFrom}-12-31`
      : activePreset === "custom"
        ? customFrom
        : presetDates.from;
  const dateTo =
    activePreset === "yoy"
      ? yoyTo === currentYear
        ? toDateStr(new Date())
        : `${yoyTo}-12-31`
      : activePreset === "custom"
        ? customTo
        : presetDates.to;

  const { data, isLoading, error } = trpc.networth.computeComparison.useQuery(
    { dateFrom, dateTo, useMarketValue },
    { enabled: !!dateFrom && !!dateTo && dateFrom < dateTo },
  );

  return (
    <Card
      title={
        <>
          Net Worth Comparison{" "}
          <HelpTip text="Compare your net worth between two dates. Portfolio values come from the nearest weekly snapshot. Home value, cash, and other items use current values for both dates." />
        </>
      }
      className="mb-8"
      isCollapsible
      isDefaultOpen={false}
    >
      {/* Preset buttons */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setActivePreset(p.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              activePreset === p.key
                ? "bg-blue-600 text-white"
                : "bg-surface-elevated text-muted hover:bg-surface-strong"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Year vs Year pickers */}
      {activePreset === "yoy" && (
        <div className="mb-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-muted text-xs">From Year</label>
            <select
              value={yoyFrom}
              onChange={(e) => setYoyFrom(Number(e.target.value))}
              className="border-strong rounded border px-2 py-1 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <span className="text-faint text-sm">vs</span>
          <div className="flex items-center gap-1.5">
            <label className="text-muted text-xs">To Year</label>
            <select
              value={yoyTo}
              onChange={(e) => setYoyTo(Number(e.target.value))}
              className="border-strong rounded border px-2 py-1 text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Custom date pickers */}
      {activePreset === "custom" && (
        <div className="mb-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-muted text-xs">From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border-strong rounded border px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-muted text-xs">To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border-strong rounded border px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}

      {/* Loading / error */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      )}
      {error && (
        <p className="text-sm text-red-500">
          Failed to load comparison: {error.message}
        </p>
      )}
      {dateFrom >= dateTo && (
        <p className="text-sm text-yellow-600">
          Start date must be before end date.
        </p>
      )}

      {/* Results */}
      {data && (
        <div className="space-y-5">
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-4">
            {/* From date */}
            <div className="text-center">
              <p className="text-muted mb-1 text-xs">
                {formatDate(data.from.date, "medium")}
              </p>
              <p className="text-primary text-lg font-semibold">
                {formatCurrency(data.from.netWorth)}
              </p>
              {data.from.snapshotDate &&
                data.from.snapshotDate !== data.from.date && (
                  <p className="text-caption text-faint">
                    Snapshot: {formatDate(data.from.snapshotDate, "medium")}
                  </p>
                )}
            </div>

            {/* Change */}
            <div className="flex flex-col items-center justify-center text-center">
              <p
                className={`text-xl font-bold ${data.absoluteChange >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {data.absoluteChange >= 0 ? "+" : ""}
                {formatCurrency(data.absoluteChange)}
              </p>
              <p
                className={`text-sm ${data.absoluteChange >= 0 ? "text-green-500" : "text-red-500"}`}
              >
                {data.percentChange >= 0 ? "+" : ""}
                {formatPercent(data.percentChange, 1)}
              </p>
            </div>

            {/* To date */}
            <div className="text-center">
              <p className="text-muted mb-1 text-xs">
                {formatDate(data.to.date, "medium")}
              </p>
              <p className="text-primary text-lg font-semibold">
                {formatCurrency(data.to.netWorth)}
              </p>
              {data.to.snapshotDate &&
                data.to.snapshotDate !== data.to.date && (
                  <p className="text-caption text-faint">
                    Snapshot: {formatDate(data.to.snapshotDate, "medium")}
                  </p>
                )}
            </div>
          </div>

          {/* Category breakdown */}
          <div className="border-subtle border-t pt-3">
            <p className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
              Change by Category
            </p>
            <div className="space-y-1.5">
              {data.categories
                .filter((c) => c.from !== 0 || c.to !== 0 || c.delta !== 0)
                .map((cat) => (
                  <div
                    key={cat.label}
                    className="flex items-center justify-between py-1 text-sm"
                  >
                    <span className="text-muted">{cat.label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-faint w-24 text-right text-xs">
                        {formatCurrency(cat.from)}
                      </span>
                      <span className="text-faint text-xs">-&gt;</span>
                      <span className="text-faint w-24 text-right text-xs">
                        {formatCurrency(cat.to)}
                      </span>
                      <span
                        className={`w-24 text-right font-medium ${
                          cat.delta > 0
                            ? "text-green-600"
                            : cat.delta < 0
                              ? "text-red-600"
                              : "text-faint"
                        }`}
                      >
                        {cat.delta > 0 ? "+" : ""}
                        {formatCurrency(cat.delta)}
                      </span>
                    </div>
                  </div>
                ))}
              {/* Total row */}
              <div className="flex items-center justify-between border-t py-1 text-sm font-semibold">
                <span className="text-primary">Net Worth</span>
                <div className="flex items-center gap-4">
                  <span className="text-muted w-24 text-right text-xs">
                    {formatCurrency(data.from.netWorth)}
                  </span>
                  <span className="text-faint text-xs">-&gt;</span>
                  <span className="text-muted w-24 text-right text-xs">
                    {formatCurrency(data.to.netWorth)}
                  </span>
                  <span
                    className={`w-24 text-right ${
                      data.absoluteChange >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {data.absoluteChange >= 0 ? "+" : ""}
                    {formatCurrency(data.absoluteChange)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Portfolio sub-breakdown by tax type */}
          {data.portfolioBreakdown.length > 0 && (
            <div className="border-subtle border-t pt-3">
              <p className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                Portfolio by Tax Type
              </p>
              <div className="space-y-1">
                {data.portfolioBreakdown.map((pb) => (
                  <div
                    key={pb.label}
                    className="flex items-center justify-between py-0.5 text-sm"
                  >
                    <span className="text-muted text-xs">{pb.label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-faint w-24 text-right text-xs">
                        {formatCurrency(pb.from)}
                      </span>
                      <span className="text-faint text-xs">-&gt;</span>
                      <span className="text-faint w-24 text-right text-xs">
                        {formatCurrency(pb.to)}
                      </span>
                      <span
                        className={`w-24 text-right text-xs font-medium ${
                          pb.delta > 0
                            ? "text-green-600"
                            : pb.delta < 0
                              ? "text-red-600"
                              : "text-faint"
                        }`}
                      >
                        {pb.delta > 0 ? "+" : ""}
                        {formatCurrency(pb.delta)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Limitations note */}
          {data.limitations.length > 0 && (
            <div className="text-caption text-faint border-subtle space-y-0.5 border-t pt-2">
              {data.limitations.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
