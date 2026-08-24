/**
 * Pure business logic for portfolio snapshot operations.
 * Extracted from admin.ts createPortfolioSnapshot — no DB or I/O dependency.
 */
import { toNumber } from "@/server/helpers/transforms";

/**
 * Build a set of account keys that were inactive in a previous snapshot.
 * Used to carry forward isActive=false status to new snapshots.
 */
export function buildPrevInactiveKeys(
  prevAccounts: {
    performanceAccountId: number | null;
    taxType: string;
    subType: string | null;
    isActive: boolean;
  }[],
): Set<string> {
  const keys = new Set<string>();
  for (const pa of prevAccounts) {
    if (!pa.isActive) {
      keys.add(
        `${pa.performanceAccountId ?? ""}_${pa.taxType}_${pa.subType ?? ""}`,
      );
    }
  }
  return keys;
}

/**
 * Build the account key for matching against previous snapshot inactive status.
 */
export function snapshotAccountKey(account: {
  performanceAccountId: number | null;
  taxType: string;
  subType: string | null;
}): string {
  return `${account.performanceAccountId ?? ""}_${account.taxType}_${account.subType ?? ""}`;
}

/**
 * Resolve whether a snapshot account should be active based on previous snapshot carry-forward.
 */
export function resolveAccountActiveStatus(
  account: {
    performanceAccountId: number | null;
    taxType: string;
    subType: string | null;
  },
  prevInactiveKeys: Set<string>,
): boolean {
  return !prevInactiveKeys.has(snapshotAccountKey(account));
}

/**
 * Compute ending balances by performance account ID from snapshot accounts.
 * Groups accounts by performanceAccountId and sums their amounts.
 * Returns the map plus a set of IDs that had duplicates (for logging).
 */
export function computeSnapshotEndingBalances(
  snapshotAccounts: { performanceAccountId: number | null; amount: string }[],
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const a of snapshotAccounts) {
    if (a.performanceAccountId) {
      totals.set(
        a.performanceAccountId,
        (totals.get(a.performanceAccountId) ?? 0) + toNumber(a.amount),
      );
    }
  }
  return totals;
}

/**
 * Zero out the amount for any account whose linked master
 * (performance_accounts) record is closed, when building a NEW snapshot.
 * Accounts with no linked performanceAccountId (unlinked/joint manual
 * entries) have no master to check and pass through unchanged.
 *
 * Zeroing (not omitting) the row is deliberate: omitting it would break
 * period conservation — the account_performance beginning balance for that
 * account would survive untouched while the snapshot total driving ending
 * balance silently dropped, producing a phantom loss equal to the closed
 * account's balance in that year's return calculation. A `0` ending
 * balance correctly reads as "this account's money left," which is what a
 * closure/rollover actually is, and reopening the account naturally
 * resumes picking up its balance with no separate recovery step.
 */
export function resolveSnapshotAccountAmounts<
  T extends {
    performanceAccountId?: number | null;
    amount: string | number;
  },
>(accounts: T[], activeMasterIds: Set<number>): T[] {
  return accounts.map((a) =>
    a.performanceAccountId != null &&
    !activeMasterIds.has(a.performanceAccountId)
      ? { ...a, amount: "0" }
      : a,
  );
}

/**
 * Resolve parentCategory for a snapshot account — prefer master record's category.
 */
export function resolveSnapshotParentCategory(
  inputCategory: string,
  performanceAccountId: number | null,
  perfCatMap: Map<number, string>,
): string {
  if (performanceAccountId) {
    return perfCatMap.get(performanceAccountId) ?? inputCategory;
  }
  return inputCategory;
}
