/**
 * Portfolio server page: prefetches netWorth.computeSummary (holdings,
 * allocations, categories). Prefetch errors fall back to the client fetch.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { PortfolioContent } from "./portfolio-content";

export default async function PortfolioPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.netWorth.computeSummary.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <PortfolioContent />
    </HydrationBoundary>
  );
}
