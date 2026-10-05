/**
 * Brokerage server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches brokerage.computeSummary — takes no input, so
 * this prefetch always matches the client's eventual query exactly (no
 * profile-resolution mismatch risk, unlike assets/contributions/expenses).
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
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
