import type { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";
import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import type { RouterOutputs } from "@/lib/trpc";
import React, { type Dispatch, type SetStateAction } from "react";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils/format";
import { gainLossTextColor } from "@/lib/utils/colors";
import { SortableHeader } from "@/components/ui/sortable-header";
import { ExpandRowButton } from "@/components/ui/expand-row-button";
import { SnapshotRowActions } from "./snapshot-rows";
import { SnapshotDetailRow } from "./snapshot-detail-row";

export type SnapshotTableProps = {
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
  rawSnapshots: RouterOutputs["networth"]["listSnapshots"]["snapshots"];
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"];
  setExpandedSnapshot: React.Dispatch<React.SetStateAction<number | null>>;
  snapshotDate: string | null | undefined;
  snapshotEditLocked: boolean;
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

/** The snapshot history table: sortable headers and one row per snapshot. */
export function SnapshotTable({
  budgetApiConnected,
  canEdit,
  deleteSnapshot,
  expandedSnapshot,
  handleBalanceEdit,
  rawSnapshots,
  resyncPush,
  setExpandedSnapshot,
  snapshotDate,
  snapshotEditLocked,
  sortOf,
  syncPending,
  syncPendingSnapshot,
  syncServiceLabel,
  toggleSnapshotEditLock,
  toggleSort,
}: SnapshotTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {SNAPSHOT_SORT_COLUMNS.map(([col, label]) => (
              <SortableHeader
                key={col}
                className={`text-muted hover:text-primary cursor-pointer ${col === "date" ? "py-2 pr-4 text-left" : "px-4 py-2 text-right"} font-medium select-none`}
                sort={sortOf(col)}
                onSort={() => toggleSort(col)}
              >
                {label}
              </SortableHeader>
            ))}
            <th className="text-muted px-4 py-2 text-right font-medium">Gap</th>
            <th className="text-muted px-4 py-2 text-left font-medium">
              Notes
            </th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody>
          {rawSnapshots.map((snap, _i) => {
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
                      <ExpandRowButton
                        expanded={isExpanded}
                        label={`Snapshot ${formatDate(snap.snapshotDate, "medium")}`}
                        glyph="triangle"
                      />
                      {formatDate(snap.snapshotDate, "medium")}
                      {syncPending?.snapshotId === snap.id && (
                        <span
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                          title={`${syncPending.count} balance change(s) not pushed to ${syncServiceLabel} yet`}
                        >
                          unsynced
                        </span>
                      )}
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
                          {delta > 0 ? "\u25b2 " : delta < 0 ? "\u25bc " : ""}
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
                  <SnapshotRowActions
                    canEdit={canEdit}
                    deleteSnapshot={deleteSnapshot}
                    isLatest={isLatest}
                    resyncPush={resyncPush}
                    snap={snap}
                  />
                </tr>
                <SnapshotDetailRow
                  budgetApiConnected={budgetApiConnected}
                  canEdit={canEdit}
                  handleBalanceEdit={handleBalanceEdit}
                  isExpanded={isExpanded}
                  isLatest={isLatest}
                  resyncPush={resyncPush}
                  snap={snap}
                  snapshotEditLocked={snapshotEditLocked}
                  syncPending={syncPending}
                  syncPendingSnapshot={syncPendingSnapshot}
                  syncServiceLabel={syncServiceLabel}
                  toggleSnapshotEditLock={toggleSnapshotEditLock}
                />
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type SnapshotFiltersProps = {
  paginatedSnapshots: RouterOutputs["networth"]["listSnapshots"];
  setShowAll: Dispatch<SetStateAction<boolean>>;
  setSnapshotDateFrom: Dispatch<SetStateAction<string>>;
  setSnapshotDateTo: Dispatch<SetStateAction<string>>;
  setSnapshotPage: Dispatch<SetStateAction<number>>;
  showAll: boolean;
  snapshotDateFrom: string;
  snapshotDateTo: string;
};

/** The snapshot history's date range filter and Show All toggle. */
export function SnapshotFilters({
  paginatedSnapshots,
  setShowAll,
  setSnapshotDateFrom,
  setSnapshotDateTo,
  setSnapshotPage,
  showAll,
  snapshotDateFrom,
  snapshotDateTo,
}: SnapshotFiltersProps) {
  return (
    <>
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
    </>
  );
}

// ---------------------------------------------------------------------------

/** The snapshot table's sortable columns, in order. */
const SNAPSHOT_SORT_COLUMNS = [
  ["date", "Date"],
  ["total", "Total"],
  ["accounts", "Accounts"],
  ["change", "Change"],
  ["changePct", "Change %"],
] as const;
