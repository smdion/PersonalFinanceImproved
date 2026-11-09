/**
 * Brokerage server page: prefetches brokerage.computeSummary (no input, so it
 * always matches the client query). Prefetch errors fall back to client fetch.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { BrokerageContent } from "./brokerage-content";

export default async function BrokeragePage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.brokerage.computeSummary.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <BrokerageContent />
    </HydrationBoundary>
  );
}
