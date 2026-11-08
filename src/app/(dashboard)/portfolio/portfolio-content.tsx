"use client";

/** Portfolio overview page (client content). The default-export Page in
 *  portfolio/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this. */

import { SinceSnapshotBanner } from "@/components/portfolio/account-live-data";
import { useState, useCallback, useMemo } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { trpc } from "@/lib/trpc";
import { errorText } from "@/lib/utils/mutation-error";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { HoldingHistorySection } from "@/components/investments/holding-history-section";
import { useFocusReveal } from "@/lib/hooks/use-focus";
import { FocusTarget } from "@/components/ui/focus-target";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { budgetApiServiceLabel } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import dynamic from "next/dynamic";
import { EDIT_LOCK_KEYS, useEditLock } from "@/components/ui/edit-lock-toggle";
import { toast } from "@/lib/hooks/use-toast";
import { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";
import { ContributionAccountsSettings } from "@/components/portfolio/contribution-accounts";
import { CardBoundary } from "@/components/dashboard/utils";
import { NewSnapshotForm } from "@/components/portfolio/new-snapshot-form";
import { SlidePanel } from "@/components/ui/slide-panel";
import { AccountBalanceOverview } from "@/components/portfolio/account-balance-overview";
import { PortfolioQuickLook } from "@/components/portfolio/portfolio-quick-look";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { SnapshotTable, SnapshotFilters } from "./snapshot-history";
import { SnapshotPagination } from "./snapshot-pagination";
import { PortfolioSyncBanner, PortfolioHeader } from "./portfolio-sections";

// Code-split Recharts. PortfolioChart pulls in
// ~250KB of recharts code; lazy-loading moves it to a dedicated chunk.
const PortfolioChart = dynamic(
  () =>
    import("@/components/portfolio/portfolio-chart").then((m) => ({
      default: m.PortfolioChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);

export function PortfolioContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "portfolio");
  const targeting = useYearEndTargetingInput();
  const summary = trpc.networth.computeSummary.useQuery(targeting);
  const { data } = summary;
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [snapshotDateFrom, setSnapshotDateFrom] = useState("");
  const [snapshotDateTo, setSnapshotDateTo] = useState("");
  const [showNewSnapshot, setShowNewSnapshot] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  // One padlock for the whole "fix a wrong balance in the latest snapshot"
  // panel — locked by default, same pattern as the Budget/Performance
  // editable surfaces. Replaces a per-value pencil affordance.
  const [snapshotEditLocked, toggleSnapshotEditLock] = useEditLock(
    EDIT_LOCK_KEYS.portfolioSnapshotEditLocked,
  );
  const [showHistory, setShowHistory] = useState(false);
  // Holding history is collapsed like the other sections, and opens when
  // a link lands on it (Benchmarks → "Your mix, in index funds").
  const [showHoldings, setShowHoldings] = useFocusReveal("holdingHistory");
  const [showChart, setShowChart] = useState(false);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<
    "date" | "total" | "accounts" | "change" | "changePct" | null
  >(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const snapshotPageSize = showAll ? 1000 : 52;
  // Dashed live line after the latest snapshot — hidden (no error) without
  // the portfolio permission it needs.
  const { data: liveSinceSnapshot } =
    trpc.investments.getLiveSinceSnapshot.useQuery(undefined, {
      retry: false,
    });
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
  const {
    deleteSnapshot,
    resyncPush,
    updateAccountBalance,
    invalidateSnapshotQueries,
  } = usePortfolioSnapshotMutations();

  const { data: syncStatus } = trpc.sync.getSyncStatus.useQuery();
  const budgetApiConnected = !!syncStatus?.connected;
  const syncServiceLabel = budgetApiServiceLabel(syncStatus?.service ?? "none");

  const {
    pending: syncPendingRaw,
    markDirty: markDirtyRaw,
    clear: clearSyncPending,
  } = useSnapshotSyncPending();
  // Only a household with a live budget-API connection has anything to
  // resync — otherwise the balance edit just saves and we're done.
  const syncPending = budgetApiConnected ? syncPendingRaw : null;
  const markDirty = useCallback(
    (snapshotId: number, snapshotDate: string) => {
      if (budgetApiConnected) markDirtyRaw(snapshotId, snapshotDate);
    },
    [budgetApiConnected, markDirtyRaw],
  );

  /** Inline balance fix on the latest snapshot. Saves + recomputes
   *  immediately; the budget-API push is NOT automatic — the snapshot is
   *  marked "not synced" and stays that way (amber banner + row badge +
   *  in-row "Sync to …" button) until the user pushes it explicitly. One
   *  push covers every pending edit, so fixing several balances is still
   *  one resync. */
  const handleBalanceEdit = useCallback(
    async (
      accountId: number,
      snapshotId: number,
      snapshotDate: string,
      rawAmount: string,
    ) => {
      const amount = rawAmount.replace(/[^0-9.]/g, "");
      const n = Number(amount);
      if (!amount || Number.isNaN(n) || n < 0) {
        toast.error("Enter a valid balance.");
        return;
      }
      try {
        const res = await updateAccountBalance.mutateAsync({
          id: accountId,
          amount,
        });
        markDirty(snapshotId, snapshotDate);
        if (res.amountEdited && res.performance === "year-finalized")
          toast.info(
            `Balance saved. ${snapshotDate.slice(0, 4)} is finalized in Performance, so its figures there didn't change.`,
          );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Couldn't update the balance.",
        );
      }
    },
    [updateAccountBalance, markDirty],
  );

  /** Push the pending balance edits for one snapshot to the budget API —
   *  one resync for all of them. Clears the "not synced" flag on success;
   *  keeps it (banner + badge stay) on failure. */
  const syncPendingSnapshot = useCallback(
    async (snapshotId: number) => {
      try {
        const r = await resyncPush.mutateAsync({
          snapshotId,
          confirmNonLatest: false,
        });
        clearSyncPending();
        toast.success(
          `Synced to ${syncServiceLabel} — posted ${r.posted}, cleaned ${r.cleaned}.`,
        );
      } catch (e) {
        toast.error(
          `Sync failed: ${errorText(e, "unknown error").replace(/\.$/, "")}. Your edits are saved — the "Sync to ${syncServiceLabel}" button is still there to retry.`,
          9000,
        );
      }
    },
    [resyncPush, clearSyncPending, syncServiceLabel],
  );

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

  const sortOf = (col: NonNullable<typeof sortCol>) =>
    sortCol !== col ? "none" : sortDir === "asc" ? "ascending" : "descending";

  if (queryPending(summary)) {
    return (
      <QueryBoundary
        query={summary}
        what="portfolio data"
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <SkeletonChart height={128} />
          </div>
        }
      />
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
      <PortfolioHeader
        canEdit={canEdit}
        setShowChart={setShowChart}
        setShowNewSnapshot={setShowNewSnapshot}
        setShowQuickLook={setShowQuickLook}
        showChart={showChart}
        showQuickLook={showQuickLook}
        snapshotDate={snapshotDate}
      />

      <PortfolioSyncBanner
        canEdit={canEdit}
        clearSyncPending={clearSyncPending}
        resyncPush={resyncPush}
        syncPending={syncPending}
        syncPendingSnapshot={syncPendingSnapshot}
        syncServiceLabel={syncServiceLabel}
      />

      {/* Change since the latest snapshot: added vs markets */}
      <SinceSnapshotBanner />

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
          <PortfolioChart
            snapshots={snapshotTotals}
            live={liveSinceSnapshot?.points}
          />
        </CardBoundary>
      )}

      {/* Lightweight account balance overview */}
      <CardBoundary title="Account Balances">
        <AccountBalanceOverview />
      </CardBoundary>

      {/* Snapshot history (paginated, collapsed by default) */}
      <CardBoundary title="Snapshot History">
        {paginatedSnapshots && paginatedSnapshots.totalCount > 0 && (
          <CollapsibleSection
            className="mt-6"
            title="Snapshot History"
            meta={`(${paginatedSnapshots.totalCount} snapshot${paginatedSnapshots.totalCount !== 1 ? "s" : ""})`}
            open={showHistory}
            onToggle={() => setShowHistory(!showHistory)}
          >
            <SnapshotFilters
              paginatedSnapshots={paginatedSnapshots}
              setShowAll={setShowAll}
              setSnapshotDateFrom={setSnapshotDateFrom}
              setSnapshotDateTo={setSnapshotDateTo}
              setSnapshotPage={setSnapshotPage}
              showAll={showAll}
              snapshotDateFrom={snapshotDateFrom}
              snapshotDateTo={snapshotDateTo}
            />

            <SnapshotTable
              budgetApiConnected={budgetApiConnected}
              canEdit={canEdit}
              deleteSnapshot={deleteSnapshot}
              expandedSnapshot={expandedSnapshot}
              handleBalanceEdit={handleBalanceEdit}
              rawSnapshots={rawSnapshots}
              resyncPush={resyncPush}
              setExpandedSnapshot={setExpandedSnapshot}
              snapshotDate={snapshotDate}
              snapshotEditLocked={snapshotEditLocked}
              sortOf={sortOf}
              syncPending={syncPending}
              syncPendingSnapshot={syncPendingSnapshot}
              syncServiceLabel={syncServiceLabel}
              toggleSnapshotEditLock={toggleSnapshotEditLock}
              toggleSort={toggleSort}
            />

            <SnapshotPagination
              paginatedSnapshots={paginatedSnapshots}
              setSnapshotPage={setSnapshotPage}
              showAll={showAll}
              snapshotPage={snapshotPage}
            />
          </CollapsibleSection>
        )}
      </CardBoundary>
      {/* Account & Contribution Settings — unified table for goal/owner/contributions */}
      <CardBoundary title="Contribution Account Settings">
        <div className="mt-8">
          <ContributionAccountsSettings />
        </div>
      </CardBoundary>
      {/* What each account held over time — entered here, read by
          Benchmarks' "Your mix, in index funds". */}
      {hasPermission(user, "portfolio") && (
        <CardBoundary title="Holding history">
          <FocusTarget topic="holdingHistory" className="mt-8">
            <CollapsibleSection
              title="Holding history"
              open={showHoldings}
              onToggle={() => setShowHoldings(!showHoldings)}
            >
              <HoldingHistorySection />
            </CollapsibleSection>
          </FocusTarget>
        </CardBoundary>
      )}
    </div>
  );
}
