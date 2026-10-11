/**
 * Benchmarks page — how your investments did against the market, then
 * holdings, allocation vs. target, drift and costs (formerly Analytics).
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { BenchmarksContent } from "./benchmarks-content";

export default async function BenchmarksPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.investments.getComparison.prefetch({}).catch(() => undefined),
      helpers.analytics.getAccounts.prefetch().catch(() => undefined),
      helpers.analytics.getSnapshots.prefetch().catch(() => undefined),
      helpers.analytics.getAssetClasses.prefetch().catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <BenchmarksContent />
    </HydrationBoundary>
  );
}
