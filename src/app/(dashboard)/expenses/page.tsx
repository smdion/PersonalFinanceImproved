/**
 * Expenses server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches budget.listApiCategories and budget.listApiActuals
 * — both take no input, so these prefetches always match the client's
 * eventual queries exactly. budget.computeActiveSummary, paycheck.
 * computeSummary, and sync.computeExpenseComparison aren't prefetched:
 * their inputs depend on client-resolved profile/scenario tiers or
 * period-selector state not available server-side.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { ExpensesContent } from "./expenses-content";

export default async function ExpensesPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.budget.listApiCategories.prefetch().catch(() => undefined),
      helpers.budget.listApiActuals.prefetch().catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <ExpensesContent />
    </HydrationBoundary>
  );
}
