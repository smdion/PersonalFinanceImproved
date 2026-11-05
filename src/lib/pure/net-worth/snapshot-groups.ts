/** A snapshot's accounts, grouped by the snapshot they belong to. */

/**
 * Group portfolio accounts by snapshotId.
 */
export function groupSnapshotAccounts<T extends { snapshotId: number }>(
  accounts: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const a of accounts) {
    const arr = map.get(a.snapshotId) ?? [];
    arr.push(a);
    map.set(a.snapshotId, arr);
  }
  return map;
}
