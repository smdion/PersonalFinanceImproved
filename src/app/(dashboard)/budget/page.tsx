/**
 * Budget server page.
 *
 * Server-side prefetches the two heavy queries the budget client needs
 * on first paint:
 *   - budget.listProfiles      (drives the profile sidebar rail)
 *   - budget.computeActiveSummary (drives the main budget table +
 *     summary bar + payroll breakdown; uses default column 0 + no
 *     profileId override because we don't know the user's
 *     persisted activeColumn selection on the server)
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so
 * the client falls back to its own fetch on error. Matches the
 * portfolio / retirement prefetch-shell pattern.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { BudgetContent } from "./budget-content";

export default async function BudgetPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.budget.listProfiles.prefetch().catch(() => undefined),
      helpers.budget.computeActiveSummary
        .prefetch({ selectedColumn: 0 })
        .catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <BudgetContent />
    </HydrationBoundary>
  );
}
