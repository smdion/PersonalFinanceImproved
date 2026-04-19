"use client";

/** Portfolio overview page (client content). The default-export Page in
 *  portfolio/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this — see v0.5 expert-review M7. */

import React, { useState, useCallback, useMemo } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  formatPercent,
  formatDate,
  accountDisplayName,
} from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { taxTypeLabel } from "@/lib/utils/colors";
import dynamic from "next/dynamic";
import { confirm } from "@/components/ui/confirm-dialog";
import { ContributionAccountsSettings } from "@/components/portfolio/contribution-accounts";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { NewSnapshotForm } from "@/components/portfolio/new-snapshot-form";
import { SlidePanel } from "@/components/ui/slide-panel";
import { AccountBalanceOverview } from "@/components/portfolio/account-balance-overview";
import { PortfolioQuickLook } from "@/components/portfolio/portfolio-quick-look";

// v0.5 expert-review M8: code-split Recharts. PortfolioChart pulls in
// ~250KB of recharts code; lazy-loading moves it to a dedicated chunk.
const PortfolioChart = dynamic(
  () =>
    import("@/components/portfolio/portfolio-chart").then((m) => ({
      default: m.PortfolioChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);

// Use centralized taxTypeLabel() from colors.ts for display labels

// ---------------------------------------------------------------------------
// Grouping helpers for snapshot display (expanded snapshot history rows)
// ---------------------------------------------------------------------------

type SnapshotAccountWithPerf = {
  institution: string;
  taxType: string;
  accountType: string;
  subType: string | null;
  amount: number;
  ownerPersonId: number | null;
  ownerName: string | null;
  performanceAccountId: number | null;
  perfAccountLabel: string | null;
  perfDisplayName: string | null;
  perfAccountType: string | null;
  perfOwnerPersonId: number | null;
};

type AccountGroup = {
  key: string;
  perfName: string;
  institution: string;
  perfAccountType: string | null;
  hasMultipleOwners: boolean;
  accounts: SnapshotAccountWithPerf[];
  total: number;
};

function groupByPerformanceAccount(
  accounts: SnapshotAccountWithPerf[],
): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const a of accounts) {
    const key = a.performanceAccountId
      ? `perf-${a.performanceAccountId}`
      : `unlinked-${a.institution}-${a.accountType}`;
    let group = groups.get(key);
    if (!group) {
      const perfName = accountDisplayName({
        displayName: a.perfDisplayName ?? null,
        accountLabel:
          a.perfAccountLabel ?? `${a.accountType} (${a.institution})`,
        accountType: a.accountType,
        institution: a.institution,
      });
      group = {
        key,
        perfName,
        institution: a.institution,
        perfAccountType: a.perfAccountType,
        hasMultipleOwners: false,
        accounts: [],
        total: 0,
      };
      groups.set(key, group);
    }
    group.accounts.push(a);
    group.total += a.amount;
  }
  // Detect multi-owner groups (e.g., joint IRA with multiple owner sub-rows)
  const result = Array.from(groups.values());
  for (const group of result) {
    const ownerIds = new Set(
      group.accounts.map((a: SnapshotAccountWithPerf) => a.ownerPersonId),
    );
    group.hasMultipleOwners = ownerIds.size > 1;
  }
  // Sort by institution first, then by name within institution
  return result.sort(
    (a, b) =>
      a.institution.localeCompare(b.institution) ||
      a.perfName.localeCompare(b.perfName),
  );
}

function buildSubRowLabel(
  a: SnapshotAccountWithPerf,
  group: AccountGroup,
): string {
  const parts: string[] = [];
  // Owner prefix for joint accounts with multiple owners
  if (group.hasMultipleOwners && a.ownerName) {
    parts.push(a.ownerName + " —");
  }
  // Show subType (e.g.,"Employer Match","Rollover") when present,
  // or raw accountType when it differs from the performance account type
  if (a.subType) {
    parts.push(`${a.subType} (${taxTypeLabel(a.taxType)})`);
  } else {
    const rawType = a.accountType.toLowerCase();
    const perfType = (group.perfAccountType ?? "").toLowerCase();
    if (rawType !== perfType && rawType !== a.taxType.toLowerCase()) {
      parts.push(`${a.accountType} (${taxTypeLabel(a.taxType)})`);
    } else {
      parts.push(taxTypeLabel(a.taxType));
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------

export function PortfolioContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.networth.computeSummary.useQuery();
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [snapshotDateFrom, setSnapshotDateFrom] = useState("");
  const [snapshotDateTo, setSnapshotDateTo] = useState("");
  const [showNewSnapshot, setShowNewSnapshot] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<
    "date" | "total" | "accounts" | "change" | "changePct" | null
  >(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const snapshotPageSize = showAll ? 1000 : 52;
  const { data: snapshotTotals } = trpc.networth.listSnapshotTotals.useQuery(
    undefined,
    {
      enabled: showChart || showQuickLook,
    },
  );
  const { data: paginatedSnapshots } = trpc.networth.listSnapshots.useQuery({
    page: showAll ? 1 : snapshotPage,
    pageSize: snapshotPageSize,
    dateFrom: snapshotDateFrom || undefined,
    dateTo: snapshotDateTo || undefined,
    sortCol: sortCol ?? undefined,
    sortDir: sortDir,
  });
  const deleteMutation = trpc.settings.portfolioSnapshots.delete.useMutation({
    onSuccess: () => {
      utils.networth.computeSummary.invalidate();
      utils.networth.listHistory.invalidate();
      utils.networth.listSnapshots.invalidate();
    },
  });
  const resyncSnapshotMutation = trpc.sync.resyncSnapshot.useMutation();

  const snapshotDate = data?.snapshotDate;

  // Memoize snapshot delta computation and sorting — must be before early returns
  const toggleSort = useCallback(
    (col: "date" | "total" | "accounts" | "change" | "changePct") => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir(col === "date" ? "asc" : "desc");
      }
    },
    [sortCol],
  );

  // Server computes delta/deltaPct and handles sorting — client just reads the result
  const rawSnapshots = useMemo(
    () => paginatedSnapshots?.snapshots ?? [],
    [paginatedSnapshots?.snapshots],
  );
  const sortedSnapshots = rawSnapshots;

  const sortIndicator = useCallback(
    (col: string) => {
      if (sortCol !== col) return " ↕";
      return sortDir === "asc" ? " ↑" : " ↓";
    },
    [sortCol, sortDir],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <SkeletonChart height={128} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load portfolio data: {error.message}
      </p>
    );
  }

  if (!data) {
    return (
      <EmptyState
        message="No portfolio data available."
        hint="Create a new snapshot to start tracking your portfolio."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Portfolio Snapshots"
        subtitle={
          snapshotDate
            ? `Last snapshot: ${formatDate(snapshotDate)}`
            : undefined
        }
      >
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQuickLook(!showQuickLook)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              showQuickLook
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-surface-strong text-secondary hover:bg-surface-strong"
            }`}
          >
            {showQuickLook ? "Hide Stats" : "Quick Look"}
          </button>
          <button
            type="button"
            onClick={() => setShowChart(!showChart)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              showChart
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-surface-strong text-secondary hover:bg-surface-strong"
            }`}
          >
            {showChart ? "Hide Chart" : "Chart"}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowNewSnapshot(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
            >
              New Snapshot
            </button>
          )}
        </span>
      </PageHeader>

      {/* Quick Look Stats Panel */}
      {showQuickLook && snapshotTotals && snapshotTotals.length >= 2 && (
        <PortfolioQuickLook snapshots={snapshotTotals} />
      )}

      {/* New Snapshot Form */}
      {canEdit && (
        <SlidePanel
          open={showNewSnapshot}
          onClose={() => setShowNewSnapshot(false)}
          title="New Snapshot"
        >
          <NewSnapshotForm
            onClose={() => setShowNewSnapshot(false)}
            onSaved={() => {
              setShowNewSnapshot(false);
              utils.networth.computeSummary.invalidate();
              utils.networth.listHistory.invalidate();
              utils.networth.listSnapshots.invalidate();
              utils.settings.portfolioSnapshots.getLatest.invalidate();
            }}
          />
        </SlidePanel>
      )}

      {/* Portfolio value chart */}
      {showChart && snapshotTotals && snapshotTotals.length > 0 && (
        <CardBoundary title="Portfolio Chart">
          <PortfolioChart snapshots={snapshotTotals} />
        </CardBoundary>
      )}

      {/* Lightweight account balance overview */}
      <CardBoundary title="Account Balances">
        <AccountBalanceOverview />
      </CardBoundary>

      {/* Snapshot history (paginated, collapsed by default) */}
      <CardBoundary title="Snapshot History">
        {paginatedSnapshots && paginatedSnapshots.totalCount > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between px-5 py-3 bg-surface-primary border rounded-lg shadow-sm hover:bg-surface-sunken transition-colors"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs text-faint transition-transform ${showHistory ? "rotate-90" : ""}`}
                >
                  &#9654;
                </span>
                <span className="font-semibold text-primary">
                  Snapshot History
                </span>
                <span className="text-xs text-faint">
                  ({paginatedSnapshots.totalCount} snapshot
                  {paginatedSnapshots.totalCount !== 1 ? "s" : ""})
                </span>
              </div>
              <span className="text-xs text-faint">
                {showHistory ? "Click to collapse" : "Click to expand"}
              </span>
            </button>

            {showHistory && (
              <Card className="mt-0 rounded-t-none border-t-0">
                {/* Date range filter + Show All toggle */}
                <div className="flex flex-wrap items-end gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      value={snapshotDateFrom}
                      onChange={(e) => {
                        setSnapshotDateFrom(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border border-strong rounded px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">
                      To
                    </label>
                    <input
                      type="date"
                      value={snapshotDateTo}
                      onChange={(e) => {
                        setSnapshotDateTo(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border border-strong rounded px-2 py-1 text-sm"
                    />
                  </div>
                  {(snapshotDateFrom || snapshotDateTo) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSnapshotDateFrom("");
                        setSnapshotDateTo("");
                        setSnapshotPage(1);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium pb-1"
                    >
                      Clear filters
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(!showAll);
                      setSnapshotPage(1);
                    }}
                    className={`text-xs font-medium pb-1 ${showAll ? "text-indigo-600 hover:text-indigo-800" : "text-muted hover:text-secondary"}`}
                  >
                    {showAll ? "Paginate (52/page)" : "Show all"}
                  </button>
                  <span className="text-xs text-faint pb-1">
                    {paginatedSnapshots.totalCount} snapshot
                    {paginatedSnapshots.totalCount !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-left py-2 pr-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("date")}
                        >
                          Date{sortIndicator("date")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("total")}
                        >
                          Total{sortIndicator("total")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("accounts")}
                        >
                          Accounts{sortIndicator("accounts")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("change")}
                        >
                          Change{sortIndicator("change")}
                        </th>
                        <th
                          className="text-right py-2 px-4 text-muted font-medium cursor-pointer select-none hover:text-primary"
                          onClick={() => toggleSort("changePct")}
                        >
                          Change %{sortIndicator("changePct")}
                        </th>
                        <th className="text-right py-2 px-4 text-muted font-medium">
                          Gap
                        </th>
                        <th className="text-left py-2 px-4 text-muted font-medium">
                          Notes
                        </th>
                        <th className="py-2 pl-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSnapshots.map((snap, _i) => {
                        const delta = snap.delta;
                        const isExpanded = expandedSnapshot === snap.id;
                        const firstSnap = rawSnapshots[0];
                        const isLatest =
                          snapshotPage === 1 &&
                          !snapshotDateFrom &&
                          !snapshotDateTo &&
                          firstSnap?.id === snap.id;
                        return (
                          <React.Fragment key={snap.id}>
                            <tr
                              className={`border-b border-subtle cursor-pointer hover:bg-surface-sunken ${isExpanded ? "bg-surface-sunken" : ""}`}
                              onClick={() =>
                                setExpandedSnapshot(isExpanded ? null : snap.id)
                              }
                            >
                              <td className="py-2 pr-4 font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className={`text-[10px] text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  >
                                    &#9654;
                                  </span>
                                  {formatDate(snap.snapshotDate, "medium")}
                                </span>
                              </td>
                              <td className="text-right py-2 px-4 font-medium">
                                {formatCurrency(snap.total)}
                              </td>
                              <td className="text-right py-2 px-4 text-muted">
                                {snap.accountCount}
                              </td>
                              <td
                                className={`text-right py-2 px-4 text-xs ${delta !== null ? (delta >= 0 ? "text-green-600" : "text-red-600") : "text-faint"}`}
                              >
                                {delta !== null
                                  ? `${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`
                                  : "\u2014"}
                              </td>
                              <td
                                className={`text-right py-2 px-4 text-xs ${snap.deltaPct !== null ? (snap.deltaPct >= 0 ? "text-green-600" : "text-red-600") : "text-faint"}`}
                              >
                                {snap.deltaPct !== null
                                  ? `${snap.deltaPct >= 0 ? "+" : ""}${formatPercent(snap.deltaPct / 100, 2)}`
                                  : "\u2014"}
                              </td>
                              <td className="text-right py-2 px-4 text-xs text-faint">
                                {snap.daysSincePrev != null
                                  ? `${snap.daysSincePrev}d`
                                  : "\u2014"}
                              </td>
                              <td className="py-2 px-4 text-muted text-xs truncate max-w-[200px]">
                                {snap.notes ?? ""}
                              </td>
                              <td
                                className="py-2 pl-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center gap-3 justify-end">
                                  {canEdit && (
                                    <button
                                      disabled={
                                        resyncSnapshotMutation.isPending
                                      }
                                      onClick={async () => {
                                        if (!isLatest) {
                                          const confirmed = await confirm(
                                            `Resync snapshot from ${snap.snapshotDate}? This is NOT the latest snapshot — resyncing it will leave later snapshots inconsistent in YNAB. Continue?`,
                                          );
                                          if (!confirmed) return;
                                        }
                                        try {
                                          const result =
                                            await resyncSnapshotMutation.mutateAsync(
                                              {
                                                snapshotId: snap.id,
                                                confirmNonLatest: !isLatest,
                                              },
                                            );
                                          alert(
                                            `Resync complete: posted ${result.posted}, cleaned ${result.cleaned}.`,
                                          );
                                        } catch (e) {
                                          alert(
                                            `Resync failed: ${e instanceof Error ? e.message : "Unknown error"}`,
                                          );
                                        }
                                      }}
                                      className="text-xs text-muted hover:text-primary disabled:opacity-50"
                                    >
                                      {resyncSnapshotMutation.isPending &&
                                      resyncSnapshotMutation.variables
                                        ?.snapshotId === snap.id
                                        ? "Resyncing…"
                                        : "Resync"}
                                    </button>
                                  )}
                                  {canEdit && !isLatest && (
                                    <button
                                      onClick={async () => {
                                        if (
                                          await confirm(
                                            `Delete snapshot from ${snap.snapshotDate}?`,
                                          )
                                        ) {
                                          deleteMutation.mutate({
                                            id: snap.id,
                                          });
                                        }
                                      }}
                                      className="text-xs text-red-400 hover:text-red-600"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && snap.accounts && (
                              <tr>
                                <td colSpan={6} className="py-0 px-0">
                                  <div className="bg-surface-sunken px-8 py-2">
                                    {groupByPerformanceAccount(
                                      snap.accounts,
                                    ).map((group) => (
                                      <div
                                        key={group.key}
                                        className="mb-2 last:mb-0"
                                      >
                                        {/* Group header — performance account name + subtotal */}
                                        <div className="flex justify-between items-baseline py-1 border-b">
                                          <span className="text-xs font-semibold text-primary">
                                            {group.perfName}
                                          </span>
                                          <span className="text-xs font-semibold text-primary">
                                            {formatCurrency(group.total)}
                                          </span>
                                        </div>
                                        {/* Sub-rows */}
                                        {group.accounts.map((a, ai) => {
                                          const subLabel = buildSubRowLabel(
                                            a,
                                            group,
                                          );
                                          return (
                                            <div
                                              // eslint-disable-next-line react/no-array-index-key -- SnapshotAccountWithPerf has no ID; index breaks ties when accountType/ownerPersonId/subType collide within a group
                                              key={`${a.accountType}-${a.ownerPersonId}-${a.subType}-${ai}`}
                                              className="flex justify-between items-baseline py-0.5 pl-4 border-b border-subtle"
                                            >
                                              <span className="text-xs text-muted">
                                                {subLabel}
                                              </span>
                                              <span className="text-xs text-secondary">
                                                {formatCurrency(a.amount)}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination controls (hidden when showing all) */}
                {!showAll && paginatedSnapshots.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}
                      disabled={snapshotPage <= 1}
                      className="px-3 py-1 text-sm text-muted hover:text-primary border border-strong rounded disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <span className="text-sm text-muted">
                      Page {paginatedSnapshots.page} of{" "}
                      {paginatedSnapshots.totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSnapshotPage((p) =>
                          Math.min(paginatedSnapshots.totalPages, p + 1),
                        )
                      }
                      disabled={snapshotPage >= paginatedSnapshots.totalPages}
                      className="px-3 py-1 text-sm text-muted hover:text-primary border border-strong rounded disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </CardBoundary>
      {/* Account & Contribution Settings — unified table for goal/owner/contributions */}
      <CardBoundary title="Contribution Account Settings">
        <div className="mt-8">
          <ContributionAccountsSettings />
        </div>
      </CardBoundary>
    </div>
  );
}
