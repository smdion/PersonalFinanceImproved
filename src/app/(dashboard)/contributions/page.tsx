/**
 * Contributions server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches contributionProfile.list — takes no input, so
 * this prefetch always matches the client's eventual query exactly.
 * contribution.computeSummary itself isn't prefetched: its input depends
 * on client-resolved profile ids not available server-side — prefetching a guessed default
 * would very likely produce a cache-key mismatch and go unused.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { ContributionsContent } from "./contributions-content";

export default async function ContributionsPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.contributionProfile.list.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <ContributionsContent />
    </HydrationBoundary>
  );
}
