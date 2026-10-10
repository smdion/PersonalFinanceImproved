/**
 * Assets server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches assets.computeSummary with no year-end targeting
 * override — matches the router's own default-active-profile resolution
 * for the common case. Same caveat as budget/page.tsx's reference pattern:
 * if the client resolves a different effective budget profile (a Plan pin
 * or persisted override), this prefetch is a no-op rather than wrong data —
 * TanStack Query dedupes by exact input, so a mismatched key just falls
 * back to the client's own fetch.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/helpers/server-trpc";
import { AssetsContent } from "./assets-content";

export default async function AssetsPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.assets.computeSummary.prefetch({}).catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <AssetsContent />
    </HydrationBoundary>
  );
}
