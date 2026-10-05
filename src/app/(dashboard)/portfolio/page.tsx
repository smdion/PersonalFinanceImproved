/**
 * Portfolio server page.
 *
 * Server-side prefetches the heavy networth.computeSummary query (the
 * source of truth for portfolio holdings, allocations, and category
 * breakdown) so PortfolioContent hydrates with data on first paint.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { PortfolioContent } from "./portfolio-content";

export default async function PortfolioPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.networth.computeSummary.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <PortfolioContent />
    </HydrationBoundary>
  );
}
