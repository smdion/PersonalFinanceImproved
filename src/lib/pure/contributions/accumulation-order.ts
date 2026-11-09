/** The order the household's contributions fill in, by category, for the
 *  PlanHealthCard's contribution-order check. */

interface ActiveContributionLite {
  accountType: string;
  allocationPriority?: number | null;
}

/**
 * Distinct category names from activeContributions in allocationPriority order (lower is
 * filled first), compared against the CFP heuristic by validateContributionOrder().
 */
export function buildAccumulationOrder(
  activeContributions: readonly ActiveContributionLite[],
): string[] {
  const sorted = [...activeContributions].sort(
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
