/**
 * Analytics page — per-account holdings, allocation vs. glide-path target, drift, and blended ER.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { AnalyticsContent } from "./analytics-content";

export default async function AnalyticsPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await Promise.all([
      helpers.analytics.getAccounts.prefetch().catch(() => undefined),
      helpers.analytics.getSnapshots.prefetch().catch(() => undefined),
      helpers.analytics.getAssetClasses.prefetch().catch(() => undefined),
      helpers.analytics.hasFmpKey.prefetch().catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <AnalyticsContent />
    </HydrationBoundary>
  );
}
