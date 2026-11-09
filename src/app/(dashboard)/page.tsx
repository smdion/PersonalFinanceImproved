/**
 * Dashboard server page: prefetches the most expensive card queries into the
 * React Query cache. Prefetch failures fall back to client fetching.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { DashboardContent } from "./dashboard-content";

export default async function DashboardPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    // Independent prefetches (one failure doesn't block the others); other
    // cards fetch on the client.
    await Promise.all([
      helpers.networth.computeSummary.prefetch().catch(() => undefined),
      helpers.settings.getOnboardingStatus.prefetch().catch(() => undefined),
    ]);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <DashboardContent />
    </HydrationBoundary>
  );
}
