/**
 * Pure business logic for portfolio snapshot operations.
 * No DB or I/O dependency.
 */
import { toNumber } from "@/lib/utils/numbers";

/** A snapshot row's sub-account identity (see {@link snapshotAccountKey}). */
type SubAccountIdentity = {
  performanceAccountId: number | null;
  taxType: string;
  subType: string | null;
  /** Null = joint (no single owner). */
  ownerPersonId: number | null;
};

/**
 * Build a set of account keys that were inactive in a previous snapshot.
 * Used to carry forward isActive=false status to new snapshots.
 */
export function buildPrevInactiveKeys(
  prevAccounts: (SubAccountIdentity & { isActive: boolean })[],
): Set<string> {
  const keys = new Set<string>();
  for (const pa of prevAccounts)
    if (!pa.isActive) keys.add(snapshotAccountKey(pa));
  return keys;
}

/**
 * A sub-account's identity across snapshots and for SimpleFIN links: tracked account, tax
 * type, subType and owner (two people's Roth rows in one IRA differ). `label` is display only.
 */
export function snapshotAccountKey(account: SubAccountIdentity): string {
  return `${account.performanceAccountId ?? ""}_${account.taxType}_${account.subType ?? ""}_${account.ownerPersonId ?? ""}`;
}

/**
 * Resolve whether a snapshot account should be active based on previous snapshot carry-forward.
 */
export function resolveAccountActiveStatus(
  account: SubAccountIdentity,
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
 * Zero the amount of accounts whose linked performance account is closed, for a new
 * snapshot. Zeroed, not omitted, so the period return doesn't book the balance as a loss.
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
