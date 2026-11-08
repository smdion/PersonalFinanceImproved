import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { CardBoundary } from "@/components/dashboard/utils";
import { SnapshotTable, SnapshotFilters } from "./snapshot-history";
import { SnapshotPagination } from "./snapshot-pagination";
import type { Dispatch, SetStateAction } from "react";
import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import type { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";
import type { RouterOutputs } from "@/lib/trpc";

export type PortfolioSnapshotHistoryProps = {
  budgetApiConnected: boolean;
  canEdit: boolean;
  deleteSnapshot: ReturnType<
    typeof usePortfolioSnapshotMutations
  >["deleteSnapshot"];
  expandedSnapshot: number | null;
  handleBalanceEdit: (
    accountId: number,
    snapshotId: number,
    snapshotDate: string,
    rawAmount: string,
  ) => Promise<void>;
  paginatedSnapshots: RouterOutputs["networth"]["listSnapshots"] | undefined;
  rawSnapshots: RouterOutputs["networth"]["listSnapshots"]["snapshots"];
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"];
  setExpandedSnapshot: Dispatch<SetStateAction<number | null>>;
  setShowAll: Dispatch<SetStateAction<boolean>>;
  setShowHistory: Dispatch<SetStateAction<boolean>>;
  setSnapshotDateFrom: Dispatch<SetStateAction<string>>;
  setSnapshotDateTo: Dispatch<SetStateAction<string>>;
  setSnapshotPage: Dispatch<SetStateAction<number>>;
  showAll: boolean;
  showHistory: boolean;
  snapshotDate: string | null | undefined;
  snapshotDateFrom: string;
  snapshotDateTo: string;
  snapshotEditLocked: boolean;
  snapshotPage: number;
  sortOf: (
    col: NonNullable<
      "date" | "total" | "accounts" | "change" | "changePct" | null
    >,
  ) => "none" | "ascending" | "descending";
  syncPending: ReturnType<typeof useSnapshotSyncPending>["pending"];
  syncPendingSnapshot: (snapshotId: number) => Promise<void>;
  syncServiceLabel: string;
  toggleSnapshotEditLock: () => void;
  toggleSort: (
    col: "date" | "total" | "accounts" | "change" | "changePct",
  ) => void;
};

export function PortfolioSnapshotHistory({
  budgetApiConnected,
  canEdit,
  deleteSnapshot,
  expandedSnapshot,
  handleBalanceEdit,
  paginatedSnapshots,
  rawSnapshots,
  resyncPush,
  setExpandedSnapshot,
  setShowAll,
  setShowHistory,
  setSnapshotDateFrom,
  setSnapshotDateTo,
  setSnapshotPage,
  showAll,
  showHistory,
  snapshotDate,
  snapshotDateFrom,
  snapshotDateTo,
  snapshotEditLocked,
  snapshotPage,
  sortOf,
  syncPending,
  syncPendingSnapshot,
  syncServiceLabel,
  toggleSnapshotEditLock,
  toggleSort,
}: PortfolioSnapshotHistoryProps) {
  return (
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
  );
}
