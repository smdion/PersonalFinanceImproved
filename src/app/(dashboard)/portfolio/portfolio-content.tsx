"use client";

/** Portfolio overview page (client content). The default-export Page in
 *  portfolio/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this. */

import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { PortfolioSyncBanner, PortfolioHeader } from "./portfolio-sections";
import { PortfolioSnapshotHistory } from "./snapshot-history-card";
import { PortfolioSettingsSections } from "./portfolio-settings-sections";
import { PortfolioPanels } from "./portfolio-panels";
import { usePortfolioPage } from "./use-portfolio-page";

export function PortfolioContent() {
  const {
    user,
    canEdit,
    summary,
    data,
    snapshotPage,
    setSnapshotPage,
    snapshotDateFrom,
    setSnapshotDateFrom,
    snapshotDateTo,
    setSnapshotDateTo,
    showNewSnapshot,
    setShowNewSnapshot,
    expandedSnapshot,
    setExpandedSnapshot,
    snapshotEditLocked,
    toggleSnapshotEditLock,
    showHistory,
    setShowHistory,
    showHoldings,
    setShowHoldings,
    showChart,
    setShowChart,
    showQuickLook,
    setShowQuickLook,
    showAll,
    setShowAll,
    liveSinceSnapshot,
    snapshotTotals,
    paginatedSnapshots,
    deleteSnapshot,
    resyncPush,
    invalidateSnapshotQueries,
    budgetApiConnected,
    syncServiceLabel,
    clearSyncPending,
    syncPending,
    handleBalanceEdit,
    syncPendingSnapshot,
    snapshotDate,
    toggleSort,
    rawSnapshots,
    sortOf,
  } = usePortfolioPage();

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

      <PortfolioPanels
        canEdit={canEdit}
        invalidateSnapshotQueries={invalidateSnapshotQueries}
        liveSinceSnapshot={liveSinceSnapshot}
        setShowNewSnapshot={setShowNewSnapshot}
        showChart={showChart}
        showNewSnapshot={showNewSnapshot}
        showQuickLook={showQuickLook}
        snapshotTotals={snapshotTotals}
      />

      {/* Snapshot history (paginated, collapsed by default) */}
      <PortfolioSnapshotHistory
        budgetApiConnected={budgetApiConnected}
        canEdit={canEdit}
        deleteSnapshot={deleteSnapshot}
        expandedSnapshot={expandedSnapshot}
        handleBalanceEdit={handleBalanceEdit}
        paginatedSnapshots={paginatedSnapshots}
        rawSnapshots={rawSnapshots}
        resyncPush={resyncPush}
        setExpandedSnapshot={setExpandedSnapshot}
        setShowAll={setShowAll}
        setShowHistory={setShowHistory}
        setSnapshotDateFrom={setSnapshotDateFrom}
        setSnapshotDateTo={setSnapshotDateTo}
        setSnapshotPage={setSnapshotPage}
        showAll={showAll}
        showHistory={showHistory}
        snapshotDate={snapshotDate}
        snapshotDateFrom={snapshotDateFrom}
        snapshotDateTo={snapshotDateTo}
        snapshotEditLocked={snapshotEditLocked}
        snapshotPage={snapshotPage}
        sortOf={sortOf}
        syncPending={syncPending}
        syncPendingSnapshot={syncPendingSnapshot}
        syncServiceLabel={syncServiceLabel}
        toggleSnapshotEditLock={toggleSnapshotEditLock}
        toggleSort={toggleSort}
      />
      <PortfolioSettingsSections
        setShowHoldings={setShowHoldings}
        showHoldings={showHoldings}
        user={user}
      />
    </div>
  );
}
