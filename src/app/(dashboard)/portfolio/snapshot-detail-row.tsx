import type { useSnapshotSyncPending } from "@/components/portfolio/use-snapshot-sync-pending";
import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { formatCurrency } from "@/lib/utils/format";
import { InlineEdit } from "@/components/ui/inline-edit";
import { EditLockToggle } from "@/components/ui/edit-lock-toggle";
import { groupByPerformanceAccount, subRowLabel } from "./snapshot-rows";
import type { RouterOutputs } from "@/lib/trpc";

export type SnapshotDetailRowProps = {
  budgetApiConnected: boolean;
  canEdit: boolean;
  handleBalanceEdit: (
    accountId: number,
    snapshotId: number,
    snapshotDate: string,
    rawAmount: string,
  ) => Promise<void>;
  isExpanded: boolean;
  isLatest: boolean;
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"];
  snap: RouterOutputs["networth"]["listSnapshots"]["snapshots"][number];
  snapshotEditLocked: boolean;
  syncPending: ReturnType<typeof useSnapshotSyncPending>["pending"];
  syncPendingSnapshot: (snapshotId: number) => Promise<void>;
  syncServiceLabel: string;
  toggleSnapshotEditLock: () => void;
};

/** An expanded snapshot's per-account balances, editable on the latest one. */
export function SnapshotDetailRow({
  budgetApiConnected,
  canEdit,
  handleBalanceEdit,
  isExpanded,
  isLatest,
  resyncPush,
  snap,
  snapshotEditLocked,
  syncPending,
  syncPendingSnapshot,
  syncServiceLabel,
  toggleSnapshotEditLock,
}: SnapshotDetailRowProps) {
  return (
    <>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="px-0 py-0">
            <div className="bg-surface-sunken px-8 py-2">
              {isLatest && canEdit && (
                <div className="mb-2 space-y-2">
                  {/* One padlock for the whole panel — no
                                            per-value pencils. Locked by default. */}
                  <div className="flex items-center gap-2 text-xs">
                    <EditLockToggle
                      locked={snapshotEditLocked}
                      onToggle={toggleSnapshotEditLock}
                    />
                    <span className="text-muted">
                      {snapshotEditLocked
                        ? "Balances are locked. Unlock to fix a wrong balance in this snapshot."
                        : `Click a balance to fix it — changes save immediately.${
                            budgetApiConnected
                              ? ` A "Sync to ${syncServiceLabel}" button appears here after an edit.`
                              : ""
                          }`}
                    </span>
                  </div>
                  {syncPending?.snapshotId === snap.id && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                      <span className="text-xs font-medium text-amber-900">
                        {syncPending.count} balance change
                        {syncPending.count === 1 ? "" : "s"} not pushed to{" "}
                        {syncServiceLabel} yet.
                      </span>
                      <button
                        type="button"
                        disabled={resyncPush.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          void syncPendingSnapshot(snap.id);
                        }}
                        className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {resyncPush.isPending
                          ? "Syncing…"
                          : `Sync to ${syncServiceLabel}`}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {groupByPerformanceAccount(snap.accounts).map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
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
                  {group.accounts.map((a) => {
                    const subLabel = subRowLabel(a, group);
                    return (
                      <div
                        key={a.id}
                        className="border-subtle flex items-baseline justify-between border-b py-0.5 pl-4"
                      >
                        <span className="text-muted text-xs">{subLabel}</span>
                        {isLatest && canEdit && !snapshotEditLocked ? (
                          <span>
                            <InlineEdit
                              value={String(a.amount)}
                              type="number"
                              hideEditIcon
                              className="text-secondary text-xs"
                              formatDisplay={(v) => formatCurrency(Number(v))}
                              parseInput={(raw) => raw.replace(/[^0-9.]/g, "")}
                              onSave={(v) =>
                                handleBalanceEdit(
                                  a.id,
                                  snap.id,
                                  snap.snapshotDate,
                                  v,
                                )
                              }
                            />
                          </span>
                        ) : (
                          <span className="text-secondary text-xs">
                            {formatCurrency(a.amount)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
