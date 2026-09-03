"use client";

/** Portfolio overview page (client content). The default-export Page in
 *  portfolio/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this. */

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
import { taxTypeLabel, gainLossTextColor } from "@/lib/utils/colors";
import { getDisplayConfig } from "@/lib/config/account-types";
import dynamic from "next/dynamic";
import { confirm } from "@/components/ui/confirm-dialog";
import { ContributionAccountsSettings } from "@/components/portfolio/contribution-accounts";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { NewSnapshotForm } from "@/components/portfolio/new-snapshot-form";
import { SlidePanel } from "@/components/ui/slide-panel";
import { AccountBalanceOverview } from "@/components/portfolio/account-balance-overview";
import { PortfolioQuickLook } from "@/components/portfolio/portfolio-quick-look";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { usePortfolioSnapshotMutations } from "@/components/portfolio/hooks/use-portfolio-snapshot-mutations";

// Code-split Recharts. PortfolioChart pulls in
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
  label: string | null;
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
        // null (not a hand-built fallback string) when there's no real
        // linked label — lets accountDisplayName fall through to its
        // casing-aware Priority-3 construction instead of returning a raw
        // lowercase DB key like "ira (Vanguard)" verbatim.
        accountLabel: a.perfAccountLabel ?? null,
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
  // Detect multi-owner groups (e.g., joint IRA with multiple owner sub-rows).
  // DESIGN.md's owner-prefix rule is a two-part test: the performance
  // account must be joint (perfOwnerPersonId null) AND sub-rows must carry
  // different ownerPersonId values — checking only the second half would
  // wrongly prefix an individually-owned account whose sub-rows happen to
  // carry mismatched owner IDs (a data inconsistency, not a real joint
  // account).
  const result = Array.from(groups.values());
  for (const group of result) {
    const isJointPerfAccount =
      (group.accounts[0]?.perfOwnerPersonId ?? null) == null;
    const ownerIds = new Set(
      group.accounts.map((a: SnapshotAccountWithPerf) => a.ownerPersonId),
    );
    group.hasMultipleOwners = isJointPerfAccount && ownerIds.size > 1;
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
  const owner = group.hasMultipleOwners && a.ownerName ? a.ownerName : null;
  const taxLabel = taxTypeLabel(a.taxType);
  // DESIGN.md's sub-account-type rule only names subType, but `label` is a
  // real, separate free-text override column on portfolio_accounts — it
  // takes precedence when set (see DESIGN.md).
  const displayName = a.label || a.subType;

  let typeLabel: string;
  if (displayName) {
    typeLabel = displayName;
  } else {
    const rawType = a.accountType.toLowerCase();
    const perfType = (group.perfAccountType ?? "").toLowerCase();
    // Documented rule (DESIGN.md): show accountType only if it differs from
    // the parent performance account's type — that's the whole test. The
    // extra `rawType !== taxType` condition previously suppressed this
    // label whenever accountType happened to equal the taxType string
    // (e.g. accountType "hsa" vs taxType "hsa"), which isn't in the spec.
    typeLabel =
      rawType !== perfType
        ? getDisplayConfig(a.accountType).displayLabel
        : taxLabel;
  }

  if (owner) {
    // Owner prefix uses an em dash (DESIGN.md "Snapshot Display" — WHO owns
    // it), distinct from the parens used below for WHAT kind of sub-account
    // it is (e.g. "Employer Match (Traditional)"). The code was the one
    // out of sync with the documented example.
    const qualifier =
      typeLabel !== taxLabel ? `${typeLabel} · ${taxLabel}` : typeLabel;
    return `${owner} — ${qualifier}`;
  }

  return typeLabel !== taxLabel ? `${typeLabel} (${taxLabel})` : typeLabel;
}

// ---------------------------------------------------------------------------

export function PortfolioContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const targeting = useYearEndTargetingInput();
  const { data, isLoading, error } =
    trpc.networth.computeSummary.useQuery(targeting);
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
  const { deleteSnapshot, resyncPush, invalidateSnapshotQueries } =
    usePortfolioSnapshotMutations();

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
      <p className="text-sm text-red-600">
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
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
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
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
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
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
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
          isOpen={showNewSnapshot}
          onClose={() => setShowNewSnapshot(false)}
          title="New Snapshot"
        >
          <NewSnapshotForm
            onClose={() => setShowNewSnapshot(false)}
            onSaved={() => {
              setShowNewSnapshot(false);
              invalidateSnapshotQueries();
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
              className="bg-surface-primary hover:bg-surface-sunken flex w-full items-center justify-between rounded-lg border px-5 py-3 shadow-sm transition-colors"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-faint text-xs transition-transform ${showHistory ? "rotate-90" : ""}`}
                >
                  &#9654;
                </span>
                <span className="text-primary font-semibold">
                  Snapshot History
                </span>
                <span className="text-faint text-xs">
                  ({paginatedSnapshots.totalCount} snapshot
                  {paginatedSnapshots.totalCount !== 1 ? "s" : ""})
                </span>
              </div>
              <span className="text-faint text-xs">
                {showHistory ? "Click to collapse" : "Click to expand"}
              </span>
            </button>

            {showHistory && (
              <Card className="mt-0 rounded-t-none border-t-0">
                {/* Date range filter + Show All toggle */}
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-muted mb-1 block text-xs font-medium">
                      From
                    </label>
                    <input
                      type="date"
                      value={snapshotDateFrom}
                      onChange={(e) => {
                        setSnapshotDateFrom(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border-strong rounded border px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-muted mb-1 block text-xs font-medium">
                      To
                    </label>
                    <input
                      type="date"
                      value={snapshotDateTo}
                      onChange={(e) => {
                        setSnapshotDateTo(e.target.value);
                        setSnapshotPage(1);
                      }}
                      className="border-strong rounded border px-2 py-1 text-sm"
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
                      className="pb-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
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
                    className={`pb-1 text-xs font-medium ${showAll ? "text-indigo-600 hover:text-indigo-800" : "text-muted hover:text-secondary"}`}
                  >
                    {showAll ? "Paginate (52/page)" : "Show all"}
                  </button>
                  <span className="text-faint pb-1 text-xs">
                    {paginatedSnapshots.totalCount} snapshot
                    {paginatedSnapshots.totalCount !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-muted hover:text-primary cursor-pointer py-2 pr-4 text-left font-medium select-none"
                          onClick={() => toggleSort("date")}
                        >
                          Date{sortIndicator("date")}
                        </th>
                        <th
                          className="text-muted hover:text-primary cursor-pointer px-4 py-2 text-right font-medium select-none"
                          onClick={() => toggleSort("total")}
                        >
                          Total{sortIndicator("total")}
                        </th>
                        <th
                          className="text-muted hover:text-primary cursor-pointer px-4 py-2 text-right font-medium select-none"
                          onClick={() => toggleSort("accounts")}
                        >
                          Accounts{sortIndicator("accounts")}
                        </th>
                        <th
                          className="text-muted hover:text-primary cursor-pointer px-4 py-2 text-right font-medium select-none"
                          onClick={() => toggleSort("change")}
                        >
                          Change{sortIndicator("change")}
                        </th>
                        <th
                          className="text-muted hover:text-primary cursor-pointer px-4 py-2 text-right font-medium select-none"
                          onClick={() => toggleSort("changePct")}
                        >
                          Change %{sortIndicator("changePct")}
                        </th>
                        <th className="text-muted px-4 py-2 text-right font-medium">
                          Gap
                        </th>
                        <th className="text-muted px-4 py-2 text-left font-medium">
                          Notes
                        </th>
                        <th className="py-2 pl-4" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSnapshots.map((snap, _i) => {
                        const delta = snap.delta;
                        const isExpanded = expandedSnapshot === snap.id;
                        // Compare against the globally-latest snapshot date
                        // (from computeSummary) rather than array position —
                        // rawSnapshots[0] is only the latest when sorted by
                        // date, and sortCol can be Total/Change/etc.
                        const isLatest =
                          !!snapshotDate && snap.snapshotDate === snapshotDate;
                        return (
                          <React.Fragment key={snap.id}>
                            <tr
                              className={`border-subtle hover:bg-surface-sunken cursor-pointer border-b ${isExpanded ? "bg-surface-sunken" : ""}`}
                              onClick={() =>
                                setExpandedSnapshot(isExpanded ? null : snap.id)
                              }
                            >
                              <td className="py-2 pr-4 font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className={`text-caption text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                  >
                                    &#9654;
                                  </span>
                                  {formatDate(snap.snapshotDate, "medium")}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right font-medium">
                                {formatCurrency(snap.total)}
                              </td>
                              <td className="text-muted px-4 py-2 text-right">
                                {snap.accountCount}
                              </td>
                              <td
                                className={`px-4 py-2 text-right text-xs ${delta !== null ? gainLossTextColor(delta) : "text-faint"}`}
                              >
                                {delta !== null ? (
                                  <>
                                    <span aria-hidden="true">
                                      {delta > 0
                                        ? "\u25b2 "
                                        : delta < 0
                                          ? "\u25bc "
                                          : ""}
                                    </span>
                                    {`${delta >= 0 ? "+" : ""}${formatCurrency(delta)}`}
                                    <span className="sr-only">
                                      {delta > 0
                                        ? " increase from previous snapshot"
                                        : delta < 0
                                          ? " decrease from previous snapshot"
                                          : " no change from previous snapshot"}
                                    </span>
                                  </>
                                ) : (
                                  "\u2014"
                                )}
                              </td>
                              <td
                                className={`px-4 py-2 text-right text-xs ${snap.deltaPct !== null ? gainLossTextColor(snap.deltaPct) : "text-faint"}`}
                              >
                                {snap.deltaPct !== null
                                  ? `${snap.deltaPct >= 0 ? "+" : ""}${formatPercent(snap.deltaPct / 100, 2)}`
                                  : "\u2014"}
                              </td>
                              <td className="text-faint px-4 py-2 text-right text-xs">
                                {snap.daysSincePrev != null
                                  ? `${snap.daysSincePrev}d`
                                  : "\u2014"}
                              </td>
                              <td className="text-muted max-w-[200px] truncate px-4 py-2 text-xs">
                                {snap.notes ?? ""}
                              </td>
                              <td
                                className="py-2 pl-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-3">
                                  {canEdit && (
                                    <button
                                      disabled={resyncPush.isPending}
                                      onClick={async () => {
                                        if (!isLatest) {
                                          const confirmed = await confirm(
                                            `Resync snapshot from ${snap.snapshotDate}? This is NOT the latest snapshot — resyncing it will leave later snapshots inconsistent in YNAB. Continue?`,
                                          );
                                          if (!confirmed) return;
                                        }
                                        try {
                                          const result =
                                            await resyncPush.mutateAsync({
                                              snapshotId: snap.id,
                                              confirmNonLatest: !isLatest,
                                            });
                                          alert(
                                            `Resync complete: posted ${result.posted}, cleaned ${result.cleaned}.`,
                                          );
                                        } catch (e) {
                                          alert(
                                            `Resync failed: ${e instanceof Error ? e.message : "Unknown error"}`,
                                          );
                                        }
                                      }}
                                      className="text-muted hover:text-primary text-xs disabled:opacity-50"
                                    >
                                      {resyncPush.isPending &&
                                      resyncPush.variables?.snapshotId ===
                                        snap.id
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
                                          deleteSnapshot.mutate({
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
                                <td colSpan={6} className="px-0 py-0">
                                  <div className="bg-surface-sunken px-8 py-2">
                                    {groupByPerformanceAccount(
                                      snap.accounts,
                                    ).map((group) => (
                                      <div
                                        key={group.key}
                                        className="mb-2 last:mb-0"
                                      >
                                        {/* Group header — performance account name + subtotal */}
                                        <div className="flex items-baseline justify-between border-b py-1">
                                          <span className="text-primary text-xs font-semibold">
                                            {group.perfName}
                                          </span>
                                          <span className="text-primary text-xs font-semibold">
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
                                              className="border-subtle flex items-baseline justify-between border-b py-0.5 pl-4"
                                            >
                                              <span className="text-muted text-xs">
                                                {subLabel}
                                              </span>
                                              <span className="text-secondary text-xs">
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
                  <div className="mt-4 flex items-center justify-between border-t pt-3">
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}
                      disabled={snapshotPage <= 1}
                      className="text-muted hover:text-primary border-strong rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span className="text-muted text-sm">
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
                      className="text-muted hover:text-primary border-strong rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
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
