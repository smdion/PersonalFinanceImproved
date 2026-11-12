import type { usePortfolioSnapshotMutations } from "@/components/portfolio/use-portfolio-snapshot-mutations";
import { type RouterOutputs } from "@/lib/trpc";
import { accountDisplayName } from "@/lib/utils/format";
import { snapshotRowLabel } from "@/lib/pure/accounts/snapshot-row-label";
import { errorText } from "@/lib/utils/mutation-error";
import { confirm } from "@/components/ui/confirm-dialog";

// ---------------------------------------------------------------------------
// Grouping helpers for snapshot display (expanded snapshot history rows)
// ---------------------------------------------------------------------------

export type SnapshotAccountWithPerf =
  RouterOutputs["netWorth"]["listSnapshots"]["snapshots"][number]["accounts"][number];

export type AccountGroup = {
  key: string;
  perfName: string;
  institution: string;
  perfAccountType: string | null;
  hasMultipleOwners: boolean;
  accounts: SnapshotAccountWithPerf[];
  total: number;
};

export function groupByPerformanceAccount(
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
        // null when there's no linked label, so accountDisplayName builds a
        // properly cased name instead of returning a raw DB key.
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
  // Owner prefix (DESIGN.md) needs both: a joint performance account
  // (perfOwnerPersonId null) AND sub-rows with different ownerPersonIds.
  // Mismatched owners on an individual account are bad data, not joint.
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

/** The owner prefix applies on a joint account whose rows have different
 *  owners (groupByPerformanceAccount sets hasMultipleOwners). */
export function subRowLabel(a: SnapshotAccountWithPerf, group: AccountGroup) {
  return snapshotRowLabel({
    ...a,
    owner: group.hasMultipleOwners ? a.ownerName : null,
    perfAccountType: group.perfAccountType,
  });
}

export type SnapshotRowActionsProps = {
  canEdit: boolean;
  deleteSnapshot: ReturnType<
    typeof usePortfolioSnapshotMutations
  >["deleteSnapshot"];
  isLatest: boolean;
  resyncPush: ReturnType<typeof usePortfolioSnapshotMutations>["resyncPush"];
  snap: RouterOutputs["netWorth"]["listSnapshots"]["snapshots"][number];
};

/** A snapshot row's edit lock, sync and delete buttons. */
export function SnapshotRowActions({
  canEdit,
  deleteSnapshot,
  isLatest,
  resyncPush,
  snap,
}: SnapshotRowActionsProps) {
  return (
    <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
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
                const result = await resyncPush.mutateAsync({
                  snapshotId: snap.id,
                  confirmNonLatest: !isLatest,
                });
                alert(
                  `Resync complete: posted ${result.posted}, cleaned ${result.cleaned}.`,
                );
              } catch (e) {
                alert(`Resync failed: ${errorText(e)}`);
              }
            }}
            className="text-muted hover:text-primary text-xs disabled:opacity-50"
          >
            {resyncPush.isPending && resyncPush.variables.snapshotId === snap.id
              ? "Resyncing…"
              : "Resync"}
          </button>
        )}
        {canEdit && !isLatest && (
          <button
            onClick={async () => {
              if (await confirm(`Delete snapshot from ${snap.snapshotDate}?`)) {
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
  );
}
