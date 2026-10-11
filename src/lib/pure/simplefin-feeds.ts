/**
 * Which SimpleFIN accounts count as a live feed for a tracked account.
 * Pure.
 *
 * Linking says which tracked account a SimpleFIN account is; the
 * "included" checkbox says whether it counts at all. An unchecked account
 * stays linked (so re-checking it restores everything) but is ignored by
 * every total, comparison, fill and check — its tracked account then goes
 * by its manual snapshot balance. One rule, used everywhere.
 */
export function countsAsFeed(a: {
  linkedPerformanceAccountId: number | null;
  isIncluded: boolean;
}): boolean {
  return a.linkedPerformanceAccountId != null && a.isIncluded;
}
