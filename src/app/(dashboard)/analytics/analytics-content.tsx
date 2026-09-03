"use client";

/**
 * Analytics page content — per-account holdings, allocation vs. glide-path
 * target, drift, and blended expense ratio.
 */

import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import dynamic from "next/dynamic";
import { sliceColor } from "@/components/analytics/analytics-charts";

// Code-split Recharts — keep its payload out of the analytics page chunk (R31).
const AllocationDonut = dynamic(
  () =>
    import("@/components/analytics/analytics-charts").then((m) => ({
      default: m.AllocationDonut,
    })),
  { ssr: false, loading: () => null },
);
const HistoricalCharts = dynamic(
  () =>
    import("@/components/analytics/analytics-charts").then((m) => ({
      default: m.HistoricalCharts,
    })),
  { ssr: false, loading: () => null },
);
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
  PieChart as PieIcon,
  AlertTriangle,
  Plus,
  Trash2,
  Search,
  Lock,
  LockOpen,
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
// Colour palette (chart slices) — reuses the shared indexed palette
// expenses-content.tsx uses for the same "arbitrary N categorical slices"
// shape (asset classes here vs. expense categories there; the name is
// expense-specific but the palette itself isn't semantically tied to it).
// ---------------------------------------------------------------------------

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
    <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      {status === "under"
        ? `Weights sum to ${pct}% — enter remaining ${deltaPct}%`
        : `Weights sum to ${pct}% — reduce by ${deltaPct}% to reach 100%`}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AllocationDonut
// ---------------------------------------------------------------------------

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
  locked = false,
  onToggleLock,
}: {
  accountId: number;
  accountName: string;
  accountBalance: number;
  snapshotId: number | undefined;
  savedHoldings: HoldingRow[];
  assetClasses: { id: number; name: string }[];
  hasFmpKey: boolean;
  onSaved: () => void;
  locked?: boolean;
  onToggleLock?: () => void;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset draft rows when snapshot changes
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
    // Capture the requested ticker so a later, faster-completing lookup for a
    // changed ticker can't be clobbered by this one resolving after it.
    const requestedTicker = ticker;
    updateRow(key, { lookupState: "loading" });
    try {
      const result = await utils.analytics.lookupTicker.fetch({ ticker });
      setDrafts((d) =>
        d.map((r) => {
          if (r.key !== key || r.ticker !== requestedTicker) return r;
          if ("error" in result && result.error) {
            const messages: Record<string, string> = {
              no_key: "No FMP key configured",
              not_found: "Ticker not found",
              rate_limit: "FMP rate limit reached (250/day)",
              error: "Lookup failed",
            };
            return {
              ...r,
              lookupState: "error",
              lookupError: messages[result.error] ?? "Lookup failed",
            };
          }
          // Find assetClassId from suggested name; only defined when the
          // response actually gives us a matching class, so we never
          // clobber a manually-entered value with null.
          let matchedAssetClassId: number | undefined;
          if (result.suggestedAssetClassName) {
            const match = assetClasses.find(
              (c) => c.name === result.suggestedAssetClassName,
            );
            if (match) matchedAssetClassId = match.id;
          }
          const hasExpenseRatio =
            result.expenseRatio !== undefined && result.expenseRatio !== null;
          return {
            ...r,
            name: result.name ?? ticker,
            expenseRatioStr: hasExpenseRatio
              ? (result.expenseRatio! * 100).toFixed(3)
              : r.expenseRatioStr,
            assetClassId:
              matchedAssetClassId !== undefined
                ? matchedAssetClassId
                : r.assetClassId,
            assetClassSource:
              matchedAssetClassId !== undefined ? "fmp" : r.assetClassSource,
            lookupState: "done",
            lookupError: undefined,
          };
        }),
      );
    } catch {
      setDrafts((d) =>
        d.map((r) =>
          r.key === key && r.ticker === requestedTicker
            ? { ...r, lookupState: "error", lookupError: "Lookup failed" }
            : r,
        ),
      );
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
          expenseRatio: (() => {
            if (!d.expenseRatioStr) return null;
            const parsed = Number(d.expenseRatioStr) / 100;
            return Number.isFinite(parsed) ? String(parsed) : null;
          })(),
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
          <span className="text-primary text-sm font-medium">
            {accountName}
          </span>
          {accountBalance > 0 && (
            <span className="text-muted ml-2 text-xs">
              {formatCurrency(accountBalance)}
            </span>
          )}
        </div>
        {onToggleLock && (
          <button
            onClick={onToggleLock}
            className="text-faint hover:text-primary p-1.5 transition-colors"
            title={locked ? "Unlock to edit" : "Lock editing"}
          >
            {locked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <LockOpen className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Holdings table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-faint border-default border-b text-xs">
              <th className="w-20 pr-2 pb-1.5 text-left">Ticker</th>
              <th className="pr-2 pb-1.5 text-left">Name</th>
              <th className="w-20 pr-2 pb-1.5 text-right">Weight %</th>
              <th className="w-20 pr-2 pb-1.5 text-right">ER %</th>
              <th className="w-36 pr-2 pb-1.5 text-left">Asset Class</th>
              <th className="w-12 pb-1.5 text-left">Src</th>
              <th className="w-8 pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((row) => (
              <tr
                key={row.key}
                className="border-subtle border-b last:border-0"
              >
                <td className="py-1 pr-2">
                  <input
                    className="border-default text-primary w-full rounded border bg-transparent px-1.5 py-0.5 font-mono text-xs uppercase focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-60"
                    value={row.ticker}
                    placeholder="VTSAX"
                    readOnly={locked}
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
                      className="border-default text-primary w-full rounded border bg-transparent px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-60"
                      value={row.name}
                      placeholder="Fund name"
                      readOnly={locked}
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
                        className="text-faint flex-shrink-0 p-0.5 hover:text-blue-600 disabled:opacity-40"
                      >
                        {row.lookupState === "loading" ? (
                          <span className="text-xs">…</span>
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {row.lookupError && (
                    <p className="mt-0.5 text-xs text-red-500">
                      {row.lookupError}
                    </p>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <input
                    className="border-default text-primary w-full rounded border bg-transparent px-1.5 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-60"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={bpsToPercent(row.weightBps) || ""}
                    placeholder="0"
                    readOnly={locked}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      if (!Number.isFinite(parsed)) return;
                      updateRow(row.key, {
                        weightBps: Math.round(
                          Math.min(100, Math.max(0, parsed)) * 100,
                        ),
                      });
                    }}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className="border-default text-primary w-full rounded border bg-transparent px-1.5 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-60"
                    type="number"
                    min={0}
                    step={0.001}
                    value={row.expenseRatioStr || ""}
                    placeholder="0.030"
                    readOnly={locked}
                    onChange={(e) =>
                      updateRow(row.key, { expenseRatioStr: e.target.value })
                    }
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    className="bg-surface-primary border-default text-primary w-full rounded border px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-60"
                    disabled={locked}
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
                    className={`rounded px-1 py-0.5 text-xs ${
                      row.assetClassSource === "fmp"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-surface-sunken text-faint"
                    }`}
                  >
                    {row.assetClassSource === "fmp" ? "FMP" : "Man"}
                  </span>
                </td>
                <td className="py-1">
                  {!locked && (
                    <button
                      onClick={() => removeRow(row.key)}
                      className="text-faint hover:text-red-500"
                      title="Remove holding"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CoverageIndicator holdings={drafts} />

      {!locked && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={addRow}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Add holding
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

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
        <tr className="text-faint border-default border-b text-xs">
          <th className="pr-2 pb-1.5 text-left">Asset Class</th>
          <th className="pr-2 pb-1.5 text-right">Target</th>
          <th className="pr-2 pb-1.5 text-right">Actual</th>
          <th className="pb-1.5 text-right">Drift</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-subtle border-b last:border-0">
            <td className="text-primary py-1 pr-2">{r.name}</td>
            <td className="text-muted py-1 pr-2 text-right">
              {formatPercent(r.target, 1)}
            </td>
            <td className="text-muted py-1 pr-2 text-right">
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

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

export function AnalyticsContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");

  // Gated on canEdit: analytics.ts's read queries require the "portfolio"
  // permission server-side too (this app has no separate read/write
  // permission tier anywhere), so a non-portfolio user hitting this page
  // would otherwise fire 7 doomed FORBIDDEN requests before the `!canEdit`
  // early return below ever renders.
  const { data: accounts, isLoading: acctLoading } =
    trpc.analytics.getAccounts.useQuery(undefined, { enabled: canEdit });
  const { data: snapshots, isLoading: snapLoading } =
    trpc.analytics.getSnapshots.useQuery(undefined, { enabled: canEdit });
  const { data: assetClasses, isLoading: acLoading } =
    trpc.analytics.getAssetClasses.useQuery(undefined, { enabled: canEdit });
  const { data: hasFmpKey } = trpc.analytics.hasFmpKey.useQuery(undefined, {
    enabled: canEdit,
  });

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<
    number | undefined
  >(undefined);
  const [holdingsLocked, setHoldingsLocked] = useState(true);

  const { data: holdings, refetch: refetchHoldings } =
    trpc.analytics.getHoldings.useQuery(
      { snapshotId: selectedSnapshotId },
      { enabled: canEdit },
    );

  const { data: history } = trpc.analytics.getHoldingsHistory.useQuery(
    {},
    { enabled: canEdit },
  );

  // Effective snapshot — from selected or from holdings query default
  const effectiveSnapshotId = selectedSnapshotId ?? holdings?.[0]?.snapshotId;

  const { data: balances } = trpc.analytics.getSnapshotBalances.useQuery(
    { snapshotId: effectiveSnapshotId! },
    { enabled: canEdit && effectiveSnapshotId !== undefined },
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
            className="border-default bg-surface-primary text-primary rounded border px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
              isCollapsible
              isDefaultOpen
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
                locked={holdingsLocked}
                onToggleLock={
                  canEdit ? () => setHoldingsLocked((l) => !l) : undefined
                }
              />
            </Card>
          ))}
        </div>
      )}

      {/* Aggregate view */}
      {hasAnyHoldings && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
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
                <p className="text-primary text-2xl font-semibold">
                  {formatPercent(blendedER, 3)}
                  <span className="text-muted ml-1 text-sm font-normal">
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
                      <p className="text-muted text-sm">
                        ≈ {formatCurrency(annualCost)} / year at current balance
                      </p>
                    );
                  })()}
                <p className="text-faint mt-2 text-xs">
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
