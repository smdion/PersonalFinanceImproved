/**
 * Portfolio server page (v0.5 expert-review M7).
 *
 * Server-side prefetches the heavy networth.computeSummary query (the
 * source of truth for portfolio holdings, allocations, and category
 * breakdown) so PortfolioContent hydrates with data on first paint.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { PortfolioContent } from "./portfolio-content";

export default async function PortfolioPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await helpers.networth.computeSummary.prefetch().catch(() => undefined);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <PortfolioContent />
    </HydrationBoundary>
  );
}
