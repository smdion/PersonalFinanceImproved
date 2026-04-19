"use client";

/**
 * Analytics page content — per-account holdings, allocation vs. glide-path
 * target, drift, and blended expense ratio.
 */

import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatCurrency,
  formatPercent,
  formatDate,
  accountDisplayName,
} from "@/lib/utils/format";
import {
  computeAllocation,
  computeDrift,
  computeBlendedER,
  aggregateHoldings,
  coverageStatus,
} from "@/lib/pure/analytics";
import { ANALYTICS_WEIGHT_COVERAGE_WARN_BPS } from "@/lib/constants";
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
import {
  PieChart as PieIcon,
  AlertTriangle,
  Plus,
  Trash2,
  Search,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HoldingRow = {
  id: number;
  performanceAccountId: number;
  snapshotId: number;
  ticker: string;
  name: string;
  weightBps: number;
  expenseRatio: string | null;
  assetClassId: number | null;
  assetClassSource: "fmp" | "manual";
};

type DraftHolding = {
  key: string; // local key for React
  ticker: string;
  name: string;
  weightBps: number;
  expenseRatioStr: string;
  assetClassId: number | null;
  assetClassSource: "fmp" | "manual";
  lookupState: "idle" | "loading" | "done" | "error";
  lookupError?: string;
};

// ---------------------------------------------------------------------------
// Colour palette (chart slices)
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
];

function sliceColor(i: number) {
  return CHART_COLORS[i % CHART_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function bpsToPercent(bps: number) {
  return bps / 100;
}

function erToDisplay(er: string | null): string {
  if (er === null || er === "") return "";
  const n = Number(er);
  if (!Number.isFinite(n)) return "";
  return (n * 100).toFixed(3);
}

// ---------------------------------------------------------------------------
// CoverageIndicator
// ---------------------------------------------------------------------------

function CoverageIndicator({ holdings }: { holdings: DraftHolding[] }) {
  const { sumBps, status } = coverageStatus(
    holdings.map((h) => ({ weightBps: h.weightBps })),
    ANALYTICS_WEIGHT_COVERAGE_WARN_BPS,
  );
  if (status === "ok") return null;

  const pct = (sumBps / 100).toFixed(1);
  const delta = Math.abs(10000 - sumBps);
  const deltaPct = (delta / 100).toFixed(1);

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-1">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      {status === "under"
        ? `Weights sum to ${pct}% — enter remaining ${deltaPct}%`
        : `Weights sum to ${pct}% — reduce by ${deltaPct}% to reach 100%`}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AllocationDonut
// ---------------------------------------------------------------------------

function AllocationDonut({
  holdings,
  assetClassNames,
}: {
  holdings: { assetClassId: number | null; weightBps: number }[];
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

// ---------------------------------------------------------------------------
// HoldingsTable — editable per account
// ---------------------------------------------------------------------------

function HoldingsTable({
  accountId,
  accountName,
  accountBalance,
  snapshotId,
  savedHoldings,
  assetClasses,
  hasFmpKey,
  onSaved,
}: {
  accountId: number;
  accountName: string;
  accountBalance: number;
  snapshotId: number | undefined;
  savedHoldings: HoldingRow[];
  assetClasses: { id: number; name: string }[];
  hasFmpKey: boolean;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();

  const [drafts, setDrafts] = useState<DraftHolding[]>(() =>
    savedHoldings.map((h) => ({
      key: String(h.id),
      ticker: h.ticker,
      name: h.name,
      weightBps: h.weightBps,
      expenseRatioStr: erToDisplay(h.expenseRatio),
      assetClassId: h.assetClassId,
      assetClassSource: h.assetClassSource,
      lookupState: "idle" as const,
    })),
  );

  useEffect(() => {
    setDrafts(
      savedHoldings.map((h) => ({
        key: String(h.id),
        ticker: h.ticker,
        name: h.name,
        weightBps: h.weightBps,
        expenseRatioStr: erToDisplay(h.expenseRatio),
        assetClassId: h.assetClassId,
        assetClassSource: h.assetClassSource,
        lookupState: "idle" as const,
      })),
    );
  }, [snapshotId, savedHoldings]);

  const [saving, setSaving] = useState(false);

  const bulkUpsert = trpc.analytics.bulkUpsertHoldings.useMutation({
    onSuccess: () => {
      utils.analytics.getHoldings.invalidate();
      utils.analytics.getHoldingsHistory.invalidate();
      onSaved();
    },
  });

  function addRow() {
    setDrafts((d) => [
      ...d,
      {
        key: `new-${Date.now()}`,
        ticker: "",
        name: "",
        weightBps: 0,
        expenseRatioStr: "",
        assetClassId: null,
        assetClassSource: "manual",
        lookupState: "idle",
      },
    ]);
  }

  function removeRow(key: string) {
    setDrafts((d) => d.filter((r) => r.key !== key));
  }

  function updateRow(key: string, patch: Partial<DraftHolding>) {
    setDrafts((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleLookup(key: string, ticker: string) {
    if (!ticker) return;
    updateRow(key, { lookupState: "loading" });
    try {
      const result = await utils.analytics.lookupTicker.fetch({ ticker });
      if ("error" in result && result.error) {
        const messages: Record<string, string> = {
          no_key: "No FMP key configured",
          not_found: "Ticker not found",
          rate_limit: "FMP rate limit reached (250/day)",
          error: "Lookup failed",
        };
        updateRow(key, {
          lookupState: "error",
          lookupError: messages[result.error] ?? "Lookup failed",
        });
        return;
      }
      // Find assetClassId from suggested name
      let assetClassId: number | null = null;
      if (result.suggestedAssetClassName) {
        const match = assetClasses.find(
          (c) => c.name === result.suggestedAssetClassName,
        );
        assetClassId = match?.id ?? null;
      }
      updateRow(key, {
        name: result.name ?? ticker,
        expenseRatioStr:
          result.expenseRatio !== undefined
            ? (result.expenseRatio * 100).toFixed(3)
            : "",
        assetClassId,
        assetClassSource: assetClassId !== null ? "fmp" : "manual",
        lookupState: "done",
        lookupError: undefined,
      });
    } catch {
      updateRow(key, { lookupState: "error", lookupError: "Lookup failed" });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const holdings = drafts
        .filter((d) => d.ticker.trim() !== "")
        .map((d) => ({
          ticker: d.ticker.trim(),
          name: d.name.trim() || d.ticker.trim(),
          weightBps: d.weightBps,
          expenseRatio: d.expenseRatioStr
            ? String(Number(d.expenseRatioStr) / 100)
            : null,
          assetClassId: d.assetClassId,
          assetClassSource: d.assetClassSource,
        }));
      if (!snapshotId) return;
      await bulkUpsert.mutateAsync({
        performanceAccountId: accountId,
        snapshotId,
        holdings,
      });
    } finally {
      setSaving(false);
    }
  }

  const assetClassNames = useMemo(
    () => new Map(assetClasses.map((c) => [c.id, c.name])),
    [assetClasses],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-primary">
            {accountName}
          </span>
          {accountBalance > 0 && (
            <span className="ml-2 text-xs text-muted">
              {formatCurrency(accountBalance)}
            </span>
          )}
        </div>
      </div>

      {/* Holdings table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-faint border-b border-default">
              <th className="text-left pb-1.5 pr-2 w-20">Ticker</th>
              <th className="text-left pb-1.5 pr-2">Name</th>
              <th className="text-right pb-1.5 pr-2 w-20">Weight %</th>
              <th className="text-right pb-1.5 pr-2 w-20">ER %</th>
              <th className="text-left pb-1.5 pr-2 w-36">Asset Class</th>
              <th className="text-left pb-1.5 w-12">Src</th>
              <th className="pb-1.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((row) => (
              <tr
                key={row.key}
                className="border-b border-subtle last:border-0"
              >
                <td className="py-1 pr-2">
                  <input
                    className="w-full bg-transparent border border-default rounded px-1.5 py-0.5 text-xs font-mono uppercase text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={row.ticker}
                    placeholder="VTSAX"
                    onChange={(e) =>
                      updateRow(row.key, {
                        ticker: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </td>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1">
                    <input
                      className="w-full bg-transparent border border-default rounded px-1.5 py-0.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={row.name}
                      placeholder="Fund name"
                      onChange={(e) =>
                        updateRow(row.key, { name: e.target.value })
                      }
                    />
                    {hasFmpKey && (
                      <button
                        title={
                          row.lookupState === "loading"
                            ? "Looking up…"
                            : (row.lookupError ?? "Look up ticker via FMP")
                        }
                        disabled={
                          row.lookupState === "loading" || !row.ticker.trim()
                        }
                        onClick={() => handleLookup(row.key, row.ticker)}
                        className="flex-shrink-0 p-0.5 text-faint hover:text-blue-600 disabled:opacity-40"
                      >
                        {row.lookupState === "loading" ? (
                          <span className="text-xs">…</span>
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {row.lookupError && (
                    <p className="text-xs text-red-500 mt-0.5">
                      {row.lookupError}
                    </p>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <input
                    className="w-full bg-transparent border border-default rounded px-1.5 py-0.5 text-xs text-right text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={bpsToPercent(row.weightBps) || ""}
                    placeholder="0"
                    onChange={(e) =>
                      updateRow(row.key, {
                        weightBps: Math.round(
                          Math.min(100, Math.max(0, Number(e.target.value))) *
                            100,
                        ),
                      })
                    }
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className="w-full bg-transparent border border-default rounded px-1.5 py-0.5 text-xs text-right text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                    type="number"
                    min={0}
                    step={0.001}
                    value={row.expenseRatioStr || ""}
                    placeholder="0.030"
                    onChange={(e) =>
                      updateRow(row.key, { expenseRatioStr: e.target.value })
                    }
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    className="w-full bg-surface-primary border border-default rounded px-1.5 py-0.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={row.assetClassId ?? ""}
                    onChange={(e) =>
                      updateRow(row.key, {
                        assetClassId: e.target.value
                          ? Number(e.target.value)
                          : null,
                        assetClassSource: "manual",
                      })
                    }
                  >
                    <option value="">— unclassified —</option>
                    {assetClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-1">
                  <span
                    className={`text-xs px-1 py-0.5 rounded ${
                      row.assetClassSource === "fmp"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-surface-sunken text-faint"
                    }`}
                  >
                    {row.assetClassSource === "fmp" ? "FMP" : "Man"}
                  </span>
                </td>
                <td className="py-1">
                  <button
                    onClick={() => removeRow(row.key)}
                    className="text-faint hover:text-red-500"
                    title="Remove holding"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CoverageIndicator holdings={drafts} />

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        >
          <Plus className="w-3.5 h-3.5" />
          Add holding
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Per-account allocation donut */}
      {drafts.some((d) => d.assetClassId !== null && d.weightBps > 0) && (
        <AllocationDonut holdings={drafts} assetClassNames={assetClassNames} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DriftTable
// ---------------------------------------------------------------------------

function DriftTable({
  actual,
  target,
  assetClassNames,
}: {
  actual: Map<number, number>;
  target: Map<number, number>;
  assetClassNames: Map<number, string>;
}) {
  const drift = computeDrift(actual, target);
  const rows = Array.from(drift.entries())
    .map(([id, d]) => ({
      id,
      name: assetClassNames.get(id) ?? `Class ${id}`,
      actual: actual.get(id) ?? 0,
      target: target.get(id) ?? 0,
      drift: d,
    }))
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-faint border-b border-default">
          <th className="text-left pb-1.5 pr-2">Asset Class</th>
          <th className="text-right pb-1.5 pr-2">Target</th>
          <th className="text-right pb-1.5 pr-2">Actual</th>
          <th className="text-right pb-1.5">Drift</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-subtle last:border-0">
            <td className="py-1 pr-2 text-primary">{r.name}</td>
            <td className="py-1 pr-2 text-right text-muted">
              {formatPercent(r.target, 1)}
            </td>
            <td className="py-1 pr-2 text-right text-muted">
              {formatPercent(r.actual, 1)}
            </td>
            <td
              className={`py-1 text-right font-medium ${
                Math.abs(r.drift) < 0.01
                  ? "text-muted"
                  : r.drift > 0
                    ? "text-amber-600"
                    : "text-blue-600"
              }`}
            >
              {r.drift > 0 ? "+" : ""}
              {formatPercent(r.drift, 1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// HistoricalCharts
// ---------------------------------------------------------------------------

function HistoricalCharts({
  history,
  assetClassNames,
}: {
  history: {
    snapshotId: number;
    snapshotDate: string;
    holdings: HoldingRow[];
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
    <Card title="Historical Allocation" collapsible defaultOpen={false}>
      <div className="text-xs text-faint mb-2">
        % allocation by asset class across snapshots
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={allocData}>
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11 }}
            width={36}
          />
          <Tooltip formatter={(v) => [formatPercent(Number(v) / 100, 1), ""]} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          {classNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={sliceColor(i)}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

export function AnalyticsContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");

  const { data: accounts, isLoading: acctLoading } =
    trpc.analytics.getAccounts.useQuery();
  const { data: snapshots, isLoading: snapLoading } =
    trpc.analytics.getSnapshots.useQuery();
  const { data: assetClasses, isLoading: acLoading } =
    trpc.analytics.getAssetClasses.useQuery();
  const { data: hasFmpKey } = trpc.analytics.hasFmpKey.useQuery();

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<
    number | undefined
  >(undefined);

  const { data: holdings, refetch: refetchHoldings } =
    trpc.analytics.getHoldings.useQuery({
      snapshotId: selectedSnapshotId,
    });

  const { data: history } = trpc.analytics.getHoldingsHistory.useQuery({});

  // Effective snapshot — from selected or from holdings query default
  const effectiveSnapshotId = selectedSnapshotId ?? holdings?.[0]?.snapshotId;

  const { data: balances } = trpc.analytics.getSnapshotBalances.useQuery(
    { snapshotId: effectiveSnapshotId! },
    { enabled: effectiveSnapshotId !== undefined },
  );

  // For now, skip age-based glide path lookup if we can't compute age
  // (age comes from people.dateOfBirth — we'd need an extra query; deferred).
  const { data: glidePathRows } = trpc.analytics.getGlidePathForAge.useQuery(
    { age: 0 },
    { enabled: false }, // disabled until age is derivable here
  );

  const isLoading = acctLoading || snapLoading || acLoading;

  const assetClassNames = useMemo(
    () => new Map((assetClasses ?? []).map((c) => [c.id, c.name])),
    [assetClasses],
  );

  const balanceByPerfAcct = useMemo(
    () =>
      new Map(
        (balances ?? []).map((b) => [b.performanceAccountId, Number(b.amount)]),
      ),
    [balances],
  );

  // Group saved holdings by account
  const holdingsByAccount = useMemo(() => {
    const map = new Map<number, HoldingRow[]>();
    for (const h of holdings ?? []) {
      const arr = map.get(h.performanceAccountId) ?? [];
      arr.push(h);
      map.set(h.performanceAccountId, arr);
    }
    return map;
  }, [holdings]);

  // Aggregate for the "all accounts" view
  const aggregated = useMemo(() => {
    if (!holdings || !accounts) return [];
    const accountInputs = (accounts ?? []).map((acct) => ({
      accountBalance: balanceByPerfAcct.get(acct.id) ?? 0,
      holdings: (holdingsByAccount.get(acct.id) ?? []).map((h) => ({
        assetClassId: h.assetClassId,
        weightBps: h.weightBps,
        expenseRatio: h.expenseRatio,
      })),
    }));
    return aggregateHoldings(accountInputs);
  }, [holdings, accounts, balanceByPerfAcct, holdingsByAccount]);

  const aggregatedAllocation = useMemo(
    () => computeAllocation(aggregated),
    [aggregated],
  );

  const blendedER = useMemo(() => computeBlendedER(aggregated), [aggregated]);

  const targetAllocation = useMemo((): Map<number, number> => {
    if (!glidePathRows) return new Map();
    return new Map(
      glidePathRows.map((r) => [r.assetClassId, Number(r.allocation)]),
    );
  }, [glidePathRows]);

  if (!canEdit) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics" />
        <EmptyState
          message="You don't have permission to view Analytics."
          hint="Ask an admin to grant portfolio access."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const hasAnyHoldings = (holdings?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="Holdings, allocation vs. target, drift, and blended expense ratio"
      >
        {/* Snapshot selector */}
        {snapshots && snapshots.length > 0 && (
          <select
            className="text-sm border border-default rounded px-2 py-1.5 bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={selectedSnapshotId ?? ""}
            onChange={(e) =>
              setSelectedSnapshotId(
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
          >
            <option value="">Latest snapshot</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {formatDate(s.snapshotDate, "medium")}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      {/* Account holdings tables */}
      {(accounts ?? []).length === 0 ? (
        <EmptyState
          icon={<PieIcon />}
          message="No active portfolio accounts."
          hint="Add accounts in Portfolio to get started."
          link={{ label: "Go to Portfolio", href: "/portfolio" }}
        />
      ) : (
        <div className="space-y-4">
          {(accounts ?? []).map((acct) => (
            <Card
              key={acct.id}
              title={accountDisplayName(acct)}
              collapsible
              defaultOpen
            >
              <HoldingsTable
                accountId={acct.id}
                accountName={accountDisplayName(acct)}
                accountBalance={balanceByPerfAcct.get(acct.id) ?? 0}
                snapshotId={effectiveSnapshotId ?? snapshots?.[0]?.id}
                savedHoldings={holdingsByAccount.get(acct.id) ?? []}
                assetClasses={assetClasses ?? []}
                hasFmpKey={hasFmpKey ?? false}
                onSaved={() => refetchHoldings()}
              />
            </Card>
          ))}
        </div>
      )}

      {/* Aggregate view */}
      {hasAnyHoldings && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Allocation donut */}
          <Card title="Allocation — All Accounts">
            <AllocationDonut
              holdings={aggregated}
              assetClassNames={assetClassNames}
            />
            {/* Legend */}
            <div className="mt-2 space-y-1">
              {Array.from(aggregatedAllocation.entries()).map(
                ([id, frac], i) => (
                  <div key={id} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: sliceColor(i) }}
                    />
                    <span className="text-muted flex-1">
                      {assetClassNames.get(id) ?? `Class ${id}`}
                    </span>
                    <span className="text-primary font-medium">
                      {formatPercent(frac, 1)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </Card>

          {/* Blended ER */}
          <Card title="Blended Expense Ratio">
            {blendedER !== null ? (
              <div className="space-y-1">
                <p className="text-2xl font-semibold text-primary">
                  {formatPercent(blendedER, 3)}
                  <span className="text-sm font-normal text-muted ml-1">
                    / year
                  </span>
                </p>
                {effectiveSnapshotId &&
                  balances &&
                  balances.length > 0 &&
                  (() => {
                    const totalBalance = (balances ?? []).reduce(
                      (s, b) => s + Number(b.amount),
                      0,
                    );
                    const annualCost = totalBalance * blendedER;
                    return (
                      <p className="text-sm text-muted">
                        ≈ {formatCurrency(annualCost)} / year at current balance
                      </p>
                    );
                  })()}
                <p className="text-xs text-faint mt-2">
                  First-year only — based on holdings with expense ratios
                  entered. Multi-year compound fee drag is not computed here.
                </p>
              </div>
            ) : (
              <EmptyState message="Enter expense ratios on your holdings to see the blended ER." />
            )}
          </Card>
        </div>
      )}

      {/* Drift table */}
      {hasAnyHoldings && targetAllocation.size > 0 && (
        <Card title="Drift from Glide Path Target">
          <DriftTable
            actual={aggregatedAllocation}
            target={targetAllocation}
            assetClassNames={assetClassNames}
          />
        </Card>
      )}

      {hasAnyHoldings && targetAllocation.size === 0 && (
        <Card title="Drift from Glide Path Target">
          <EmptyState
            message="Configure your glide path to see drift from target."
            link={{ label: "Go to Retirement settings", href: "/retirement" }}
          />
        </Card>
      )}

      {/* Historical charts */}
      {history && history.length >= 2 && (
        <HistoricalCharts history={history} assetClassNames={assetClassNames} />
      )}
    </div>
  );
}
