/**
 * The active-profile predicate for callers that already hold every profile in memory
 * (same rule as `getActiveBudgetProfile`).
 */
export function pickActiveBudgetProfile<T extends { isActive: boolean }>(
  profiles: T[],
): T | undefined {
  return profiles.find((p) => p.isActive);
}
