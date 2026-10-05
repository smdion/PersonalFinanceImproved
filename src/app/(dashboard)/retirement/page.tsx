/**
 * Retirement server page.
 *
 * Server-side prefetches projection.computeProjection so the projection
 * card hydrates with data on first paint instead of waterfalling through
 * useQuery on the client. The RetirementContent client component consumes
 * the same query via tRPC hooks — it reads the prefetched data from the
 * React Query cache when the input matches.
 *
 * The prefetch uses an *empty* input (no overrides) which matches what a
 * fresh page load sends on initial render. Users with persisted UI state
 * (debounced overrides, snapshot pin, contribution profile selection) will
 * miss the cache and fall back to client fetch — that's the fallback
 * behavior everywhere else, so it's a strict win for the common case.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
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
