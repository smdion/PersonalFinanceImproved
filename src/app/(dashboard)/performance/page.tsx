/**
 * Performance server page (server-prefetch split).
 *
 * Server-side prefetches performance.computeSummary — the source of truth
 * for the page's annual/account performance tables. Takes no input, so the
 * prefetch cache key matches the client's eventual query exactly (same as
 * brokerage.computeSummary). Saved settings (the six column/filter toggles)
 * come with every prefetchForPage.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
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
