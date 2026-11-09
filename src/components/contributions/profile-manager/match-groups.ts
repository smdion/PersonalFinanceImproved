/**
 * Groups `accountDetails` by (person, accountType): one active split holds the employer match
 * config and it applies to the group's combined contributions, so siblings without config
 * still earn a proportional share. Shared by the summary and editable account tables.
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
