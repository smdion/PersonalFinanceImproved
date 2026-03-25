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
