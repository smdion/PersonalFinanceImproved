/**
 * The active-profile predicate, for callers that already have every profile
 * loaded in memory (e.g. the retirement engine payload builder, which fetches
 * `allBudgetProfiles` once for several purposes) and would otherwise
 * duplicate `getActiveBudgetProfile`'s `isActive` lookup inline.
 */
export function pickActiveBudgetProfile<T extends { isActive: boolean }>(
  profiles: T[],
): T | undefined {
  return profiles.find((p) => p.isActive);
}
