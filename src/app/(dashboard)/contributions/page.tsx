/**
 * Contributions server page: prefetches contributionProfile.list (no input).
 * computeSummary needs client-resolved profile ids, so it isn't prefetched.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
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
