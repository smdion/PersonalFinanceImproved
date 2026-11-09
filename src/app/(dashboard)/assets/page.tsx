/**
 * Assets server page: prefetches assets.computeSummary for the active profile.
 * A client-side profile selection misses this key and fetches on its own;
 * prefetch errors are caught so the client fetch takes over.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
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
