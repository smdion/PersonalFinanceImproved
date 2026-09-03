"use client";

/** Utilities tracker — gas/water/electric cost & usage history with annual trend charts and a collapsible per-year drill-down. */

import { useState } from "react";
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
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatPercent,
  compactCurrency,
} from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import { gridProps, axisProps } from "@/components/charts";
import { ChevronDown, ChevronRight, Lock, LockOpen } from "lucide-react";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Per-kind accent for the trend chart — references CHART_COLORS, never raw hex.
const KIND_COLOR: Record<string, string> = {
  gas: CHART_COLORS.cash, // amber
  water: CHART_COLORS.house, // blue
  electric: CHART_COLORS.perfReturn, // emerald
};

// Mirrors the utilities.computeSummary router output (hand-written to avoid
// importing server types into the client bundle).
type UtilityReadingRow = {
  id: number;
  month: number;
  cost: number;
  usage: number | null;
  note: string | null;
  costPerUnit: number | null;
};
type UtilityYearRow = {
  year: number;
  readingCount: number;
  totalCost: number;
  avgCost: number;
  minCost: number;
  maxCost: number;
  totalUsage: number | null;
  avgUsage: number | null;
  minUsage: number | null;
  maxUsage: number | null;
  costPerUnit: number | null;
  yoyCostPct: number | null;
  readings: UtilityReadingRow[];
};
type UtilitySummary = {
  serviceId: number;
  kind: string;
  providerName: string;
  usageUnit: string | null;
  sortOrder: number;
  active: boolean;
  latestYear: number | null;
  latestYearTotalCost: number | null;
  latestYearTotalUsage: number | null;
  latestCostPerUnit: number | null;
  latestYoyCostPct: number | null;
  years: UtilityYearRow[];
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Small green/red YoY pill (down = good for cost). */
function YoYTag({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-faint">—</span>;
  const good = pct <= 0;
  return (
    <span className={good ? "text-green-600" : "text-red-600"}>
      {pct >= 0 ? "↑" : "↓"} {formatPercent(Math.abs(pct), 1)}
    </span>
  );
}

/** Annual cost trend (one bar per year). */
function CostTrend({
  years,
  color,
  unit,
}: {
  years: UtilityYearRow[];
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
          <Bar dataKey="cost" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((d) => (
              <Cell key={d.year} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function UtilityCard({
  svc,
  toggled,
  toggleYear,
}: {
  svc: UtilitySummary;
  toggled: Set<string>;
  toggleYear: (key: string) => void;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.utilities.invalidate();
  const unit = svc.usageUnit ?? "unit";

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [newMonth, setNewMonth] = useState("1");
  const [newCost, setNewCost] = useState("");
  const [newUsage, setNewUsage] = useState("");
  const [newNote, setNewNote] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCost, setEditCost] = useState("");
  const [editUsage, setEditUsage] = useState("");
  const [editNote, setEditNote] = useState("");

  const resetAdd = () => {
    setAdding(false);
    setNewCost("");
    setNewUsage("");
    setNewNote("");
  };

  const upsertReading = trpc.utilities.upsertReading.useMutation({
    onSuccess: () => {
      invalidate();
      resetAdd();
    },
  });
  const updateReading = trpc.utilities.updateReading.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
  });
  const deleteReading = trpc.utilities.deleteReading.useMutation({
    onSuccess: invalidate,
  });

  const yearsDesc = svc.years.slice().sort((a, b) => b.year - a.year);

  return (
    <Card
      title={`${capitalize(svc.kind)} — ${svc.providerName}`}
      headerRight={
        <span className="inline-flex items-center gap-2">
          <button
            onClick={() => setIsUnlocked((l) => !l)}
            className="text-faint hover:text-primary p-1 transition-colors"
            title={isUnlocked ? "Lock editing" : "Unlock to edit"}
          >
            {isUnlocked ? (
              <LockOpen className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
          </button>
          {isUnlocked && (
            <button
              onClick={() => setAdding((p) => !p)}
              className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong rounded px-2 py-1 font-medium transition-colors"
            >
              {adding ? "Cancel" : "+ Add"}
            </button>
          )}
        </span>
      }
    >
      {svc.years.length > 1 && (
        <CostTrend
          years={svc.years}
          color={KIND_COLOR[svc.kind] ?? CHART_COLORS.house}
          unit={unit}
        />
      )}

      {adding && (
        <div className="mt-2 mb-2 flex flex-wrap items-center gap-2 border-b py-2">
          <input
            type="number"
            value={newYear}
            onChange={(e) => setNewYear(e.target.value)}
            placeholder="Year"
            className="border-strong bg-surface-primary w-16 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
          />
          <select
            value={newMonth}
            onChange={(e) => setNewMonth(e.target.value)}
            className="border-strong bg-surface-primary rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            placeholder="Cost"
            className="border-strong bg-surface-primary w-24 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
          />
          <input
            type="number"
            value={newUsage}
            onChange={(e) => setNewUsage(e.target.value)}
            placeholder={`Usage (${unit})`}
            className="border-strong bg-surface-primary w-28 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
          />
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Note"
            className="border-strong bg-surface-primary min-w-[8rem] flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
          />
          <Button
            size="xs"
            onClick={() => {
              if (newCost && newYear && newMonth) {
                upsertReading.mutate({
                  serviceId: svc.serviceId,
                  year: Number(newYear),
                  month: Number(newMonth),
                  cost: newCost,
                  usage: newUsage ? newUsage : null,
                  note: newNote || null,
                });
              }
            }}
            disabled={!newCost || !newYear || !newMonth}
          >
            Save
          </Button>
        </div>
      )}

      {/* Year accordion */}
      <div className="mt-2">
        {yearsDesc.map((year) => {
          const key = `${svc.serviceId}:${year.year}`;
          // Latest year defaults open; a user toggle flips the default.
          const open = (year.year === svc.latestYear) !== toggled.has(key);
          return (
            <div
              key={year.year}
              className="border-subtle border-b last:border-0"
            >
              <button
                onClick={() => toggleYear(key)}
                className="hover:bg-surface-sunken flex w-full items-center gap-2 py-2 text-left transition-colors"
              >
                {open ? (
                  <ChevronDown className="text-faint h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="text-faint h-3.5 w-3.5 shrink-0" />
                )}
                <span className="w-14 font-medium">{year.year}</span>
                <span className="flex-1 text-right font-medium tabular-nums">
                  {formatCurrency(year.totalCost)}
                </span>
                <span className="text-muted w-28 text-right text-xs tabular-nums">
                  {year.costPerUnit != null
                    ? `${formatCurrency(year.costPerUnit)}/${unit}`
                    : "—"}
                </span>
                <span className="w-20 text-right text-xs">
                  <YoYTag pct={year.yoyCostPct} />
                </span>
                <span className="text-faint w-16 text-right text-xs">
                  {year.readingCount} mo
                </span>
              </button>

              {open && (
                <table className="mb-2 w-full text-sm">
                  <thead>
                    <tr className="text-faint border-subtle border-b text-left text-xs">
                      <th className="py-1 pl-6 font-medium">Month</th>
                      <th className="py-1 text-right font-medium">Cost</th>
                      <th className="py-1 text-right font-medium">Usage</th>
                      <th className="py-1 text-right font-medium">
                        $ / {unit}
                      </th>
                      <th className="py-1 font-medium">Note</th>
                      <th className="w-8 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {year.readings.map((r) =>
                      editingId === r.id ? (
                        <tr key={r.id} className="bg-blue-50/30">
                          <td className="text-muted py-1.5 pl-6">
                            {MONTH_NAMES[r.month - 1]}
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number"
                              value={editCost}
                              onChange={(e) => setEditCost(e.target.value)}
                              className="border-strong bg-surface-primary w-20 rounded border px-2 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                              autoFocus
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number"
                              value={editUsage}
                              onChange={(e) => setEditUsage(e.target.value)}
                              className="border-strong bg-surface-primary w-24 rounded border px-2 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                              placeholder="—"
                            />
                          </td>
                          <td className="py-1.5" />
                          <td className="py-1.5">
                            <input
                              type="text"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              className="border-strong bg-surface-primary w-full rounded border px-2 py-0.5 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                              placeholder="Note"
                            />
                          </td>
                          <td className="py-1.5 whitespace-nowrap">
                            <Button
                              size="xs"
                              onClick={() => {
                                if (editCost) {
                                  updateReading.mutate({
                                    id: r.id,
                                    cost: editCost,
                                    usage: editUsage ? editUsage : null,
                                    note: editNote || null,
                                  });
                                }
                              }}
                              disabled={!editCost}
                            >
                              Save
                            </Button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong ml-1 rounded px-1.5 py-0.5 font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={r.id}
                          className={`group border-subtle/60 hover:bg-surface-sunken border-b ${isUnlocked ? "cursor-pointer" : ""}`}
                          onClick={() => {
                            if (!isUnlocked) return;
                            setEditingId(r.id);
                            setEditCost(String(r.cost));
                            setEditUsage(
                              r.usage != null ? String(r.usage) : "",
                            );
                            setEditNote(r.note ?? "");
                          }}
                        >
                          <td className="text-muted py-1.5 pl-6">
                            {MONTH_NAMES[r.month - 1]}
                          </td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {formatCurrency(r.cost)}
                          </td>
                          <td className="text-muted py-1.5 text-right tabular-nums">
                            {r.usage != null ? r.usage.toLocaleString() : "—"}
                          </td>
                          <td className="text-muted py-1.5 text-right tabular-nums">
                            {r.costPerUnit != null
                              ? formatCurrency(r.costPerUnit)
                              : "—"}
                          </td>
                          <td className="text-muted max-w-[140px] truncate py-1.5 text-xs">
                            {r.note ?? ""}
                          </td>
                          <td className="py-1.5">
                            {isUnlocked && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteReading.mutate({ id: r.id });
                                }}
                                className="text-faint p-0.5 transition-all hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                                title="Delete"
                              >
                                <svg
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function UtilitiesPage() {
  const { data, isLoading } = trpc.utilities.computeSummary.useQuery();
  const summaries: UtilitySummary[] = data?.summaries ?? [];

  // We track only the years the user has *toggled* away from their default.
  // Each service's latest year defaults to open, the rest closed — so a year is
  // open when `(isLatest) XOR (toggled)`. This avoids seeding state in an effect.
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const toggleYear = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonChart key={i} height={112} />
          ))}
        </div>
        <SkeletonChart height={256} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilities"
        subtitle="Gas, water, and electric cost & usage history"
      />

      {summaries.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-muted">No utility data yet</p>
            <p className="text-faint mt-2 text-sm">
              Run <code className="text-xs">scripts/import-utilities.ts</code>{" "}
              to import the House Upkeep spreadsheet, or unlock a service to add
              readings.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Summary cards — latest year at a glance */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((svc) => {
              const unit = svc.usageUnit ?? "";
              const perUnit =
                svc.latestCostPerUnit != null
                  ? `${formatCurrency(svc.latestCostPerUnit)}${unit ? `/${unit}` : ""}`
                  : null;
              const labelParts = [
                svc.latestYear != null ? String(svc.latestYear) : null,
                perUnit,
              ].filter(Boolean);
              return (
                <Card
                  key={svc.serviceId}
                  title={
                    <span className="flex items-center justify-between">
                      {capitalize(svc.kind)}
                      <span className="text-xs font-normal">
                        <YoYTag pct={svc.latestYoyCostPct} />
                      </span>
                    </span>
                  }
                >
                  <Metric
                    value={formatCurrency(svc.latestYearTotalCost ?? 0)}
                    label={
                      labelParts.length ? labelParts.join(" · ") : undefined
                    }
                  />
                </Card>
              );
            })}
          </div>

          {/* Per-utility detail */}
          {summaries.map((svc) => (
            <UtilityCard
              key={svc.serviceId}
              svc={svc}
              toggled={toggled}
              toggleYear={toggleYear}
            />
          ))}
        </>
      )}
    </div>
  );
}
