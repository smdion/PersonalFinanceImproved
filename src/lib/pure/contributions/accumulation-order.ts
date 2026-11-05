/** The order the household's contributions fill in, by category, for the
 *  PlanHealthCard's contribution-order check. */

interface ActiveContribLite {
  accountType: string;
  allocationPriority?: number | null;
}

/**
 * accumulationOrder: distinct category names from activeContribs in their
 * allocationPriority order (lower = higher priority = filled first). The
 * validateContributionOrder() helper compares this against the CFP
 * heuristic.
 */
export function buildAccumulationOrder(
  activeContribs: readonly ActiveContribLite[],
): string[] {
  const sorted = [...activeContribs].sort(
    (a, b) => (a.allocationPriority ?? 0) - (b.allocationPriority ?? 0),
  );
  const seen = new Set<string>();
  const order: string[] = [];
  for (const c of sorted) {
    if (!seen.has(c.accountType)) {
      seen.add(c.accountType);
      order.push(c.accountType);
    }
  }
  return order;
}
