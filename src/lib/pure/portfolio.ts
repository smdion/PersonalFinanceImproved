/**
 * Pure business logic for portfolio snapshot operations.
 * No DB or I/O dependency.
 */
import { toNumber } from "@/server/helpers/transforms";

/** A snapshot row's sub-account identity (see {@link snapshotAccountKey}). */
export type SubAccountIdentity = {
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
 * A sub-account's identity across snapshots: tracked account, tax type,
 * kind (subType) and owner. Sub-accounts exist only as snapshot rows (one
 * tracked account holds several — each spouse's Roth in a joint IRA, a
 * 401k's Roth + Traditional + match; DESIGN.md "Performance Accounts"), so
 * this key is how a row is recognised from one snapshot to the next and
 * how a SimpleFIN account links to one. The owner is part of it: two
 * people's Roth rows in one joint IRA are different sub-accounts. The
 * free-text `label` is a display override and deliberately not part of it.
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
