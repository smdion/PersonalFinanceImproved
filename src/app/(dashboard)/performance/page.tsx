/**
 * Performance server page: prefetches performance.computeSummary (no input, so
 * the key always matches). Saved settings come from the layout's prefetch.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { PerformanceContent } from "./performance-content";

export default async function PerformancePage() {
  const dehydratedState = await prefetchForPage((helpers) =>
    helpers.performance.computeSummary.prefetch().catch(() => undefined),
  );

  return (
    <HydrationBoundary state={dehydratedState}>
      <PerformanceContent />
    </HydrationBoundary>
  );
}
