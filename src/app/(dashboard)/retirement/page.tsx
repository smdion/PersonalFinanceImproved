/**
 * Retirement server page: prefetches projection.computeProjection with the empty
 * input a fresh load sends; persisted UI state misses the key and fetches on the
 * client. Prefetch errors fall back to the client fetch.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { RetirementContent } from "./retirement-content";

export default async function RetirementPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.projection.computeProjection
      .prefetch({})
      .catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <RetirementContent />
    </HydrationBoundary>
  );
}
