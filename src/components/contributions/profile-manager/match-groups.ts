/**
 * At most one active contribution per (person, accountType) group holds
 * real employer match config (computeGroupedEmployerMatch enforces this) —
 * its match applies to the whole group, combining every active split's
 * contribution before capping. A sibling split with no config of its own
 * still earns a real, proportional share of that match — this groups
 * `accountDetails` so callers can say so instead of showing nothing.
 * Shared by the read-only summary table and the editable account table
 * (both render the same profile's accounts, previously duplicated this
 * grouping independently).
 */
export function groupSharedMatchAccounts<
  T extends {
    id: number;
    personId: number | null;
    accountType: string;
    liveMatchType: string | null;
  },
>(
  accountDetails: T[],
): {
  sharedMatchSource: Map<number, T>;
  combinedGroupIds: Set<number>;
} {
  const groups = new Map<string, T[]>();
  for (const ad of accountDetails) {
    const key = `${ad.personId}:${ad.accountType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ad);
  }
  const sharedMatchSource = new Map<number, T>();
  // ids of every row (both the config-holding row and its sibling) in a
  // group whose match is combined across a split — used to show the same
  // "combined" note on both rows.
  const combinedGroupIds = new Set<number>();
  groups.forEach((group) => {
    if (group.length <= 1) return;
    const withMatch = group.filter(
      (ad) => ad.liveMatchType && ad.liveMatchType !== "none",
    );
    const matchSource = withMatch[0];
    if (withMatch.length !== 1 || !matchSource) return;
    for (const ad of group) combinedGroupIds.add(ad.id);
    for (const ad of group) {
      if (ad.id !== matchSource.id) {
        sharedMatchSource.set(ad.id, matchSource);
      }
    }
  });
  return { sharedMatchSource, combinedGroupIds };
}
